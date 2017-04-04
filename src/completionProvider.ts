/* Copyright © Ben Mewburn ben@mewburn.id.au
 * Licensed under the MIT Licence.
 */

'use strict';

import {
    Token, TokenType, Phrase, PhraseType,
    NamespaceName
} from 'php7parser';
import {
    PhpSymbol, SymbolStore, SymbolTable, SymbolKind, SymbolModifier,
    TypeString, NameResolver
} from './symbol';
import { ParsedDocument, ParsedDocumentStore } from './parsedDocument';
import { Predicate } from './types';
import { Context } from './context';
import * as lsp from 'vscode-languageserver-types';

const noCompletionResponse: lsp.CompletionList = {
    items: [],
    isIncomplete: false
};

function keywordCompletionItems(keywords: string[], text: string) {

    let kw: string;
    let items: lsp.CompletionItem[] = [];
    for (let n = 0, l = keywords.length; n < l; ++n) {

        kw = keywords[n];
        if (kw.indexOf(text) === 0) {
            items.push({
                label: kw,
                kind: lsp.CompletionItemKind.Keyword
            });
        }

    }

    return keywords;

}

function toNameCompletionItem(s: PhpSymbol, namespace: string, namePhraseType: PhraseType) {

    let label = s.name;
    let detail = s.name;
    if (namespace && s.name.indexOf(namespace) === 0 && label.length > namespace.length + 1) {
        label = label.slice(namespace.length + 1);
    } else if (namespace && namePhraseType !== PhraseType.FullyQualifiedName && !(s.modifiers & SymbolModifier.Use)) {
        label = '\\' + label;
    } else if ((s.modifiers & SymbolModifier.Use) > 0 && s.associated && s.associated.length > 0) {
        detail = s.associated[0].name;
    }

    let kind: lsp.CompletionItemKind;

    switch (s.kind) {
        case SymbolKind.Class:
            kind = lsp.SymbolKind.Class;
            break;
        case SymbolKind.Function:
            kind = lsp.SymbolKind.Function;
            break;
        case SymbolKind.Constant:
            kind = lsp.SymbolKind.Constant;
            break;
        default:
            break;
    }

    return <lsp.CompletionItem>{
        label: label,
        kind: kind,
        detail: detail,
        documentation: s.description
    }

}

export class CompletionProvider {

    private _strategies: CompletionStrategy[];

    constructor(
        public symbolStore: SymbolStore,
        public documentStore: ParsedDocumentStore,
        public maxSuggestions: number) {

        this._strategies = [
            new ClassTypeDesignatorCompletion(maxSuggestions),
            new SimpleVariableCompletion(maxSuggestions)
        ];

    }


    provideCompletions(uri: string, position: lsp.Position) {

        let doc = this.documentStore.find(uri);

        if (!doc) {
            return noCompletionResponse;
        }

        let context = new Context(this.symbolStore, doc, position);
        let strategy: CompletionStrategy = null;

        for (let n = 0, l = this._strategies.length; n < l; ++n) {
            if (this._strategies[n].canSuggest(context)) {
                strategy = this._strategies[n];
                break;
            }
        }

        return strategy ? strategy.completions(context) : noCompletionResponse;

    }

    private _importedSymbolFilter(s: PhpSymbol) {
        return (s.modifiers & SymbolModifier.Use) > 0 &&
            (s.kind & (SymbolKind.Class | SymbolKind.Constant | SymbolKind.Function)) > 0
    }

    private _phraseType(p: Phrase) {
        return p.phraseType;
    }

}

interface CompletionStrategy {

    canSuggest(context: Context): boolean;
    completions(context: Context): lsp.CompletionList;

}

class ClassTypeDesignatorCompletion implements CompletionStrategy {

    private static _keywords = [
        'class', 'static'
    ];

    constructor(public maxSuggestions: number) {

    }

    canSuggest(context: Context) {

        let traverser = context.createTraverser();

        return ParsedDocument.isToken(traverser.node, [TokenType.Backslash, TokenType.Name]) &&
            ParsedDocument.isPhrase(traverser.parent(), [PhraseType.NamespaceName]) &&
            ParsedDocument.isPhrase(traverser.parent(),
                [PhraseType.FullyQualifiedName, PhraseType.QualifiedName, PhraseType.RelativeQualifiedName]) &&
            ParsedDocument.isPhrase(traverser.parent(), [PhraseType.ClassTypeDesignator]);

    }

    completions(context: Context) {

        let items: lsp.CompletionItem[] = [];
        let traverser = context.createTraverser();
        let nsNameNode = traverser.parent() as NamespaceName;
        let qNameNode = traverser.parent() as Phrase;
        let nameResolver = context.createNameResolver();
        let text = nameResolver.namespaceNamePhraseText(nsNameNode, context.offset);
        if (!text) {
            return noCompletionResponse;
        }

        if (qNameNode.phraseType === PhraseType.QualifiedName) {
            Array.prototype.push.apply(items, keywordCompletionItems(ClassTypeDesignatorCompletion._keywords, text));

        }

        if (qNameNode.phraseType === PhraseType.RelativeQualifiedName) {
            text = nameResolver.resolveRelative(text);
        }

        let matches = context.symbolStore.match(text, this._symbolFilter);

        let limit = Math.min(matches.length, this.maxSuggestions - items.length);
        let isIncomplete = matches.length > this.maxSuggestions - items.length;

        for (let n = 0; n < limit; ++n) {
            items.push(toNameCompletionItem(matches[n], nameResolver.namespaceName, qNameNode.phraseType));
        }

        return <lsp.CompletionList>{
            items: items,
            isIncomplete: isIncomplete
        }
    }

    private _symbolFilter(s: PhpSymbol) {
        return s.kind === SymbolKind.Class &&
            !(s.modifiers & (SymbolModifier.Anonymous | SymbolModifier.Abstract));
    }



}

class SimpleVariableCompletion implements CompletionStrategy {

    constructor(public maxSuggestions) {

    }

    canSuggest(context: Context) {
        let traverser = context.createTraverser();
        return ParsedDocument.isToken(traverser.node, [TokenType.Dollar, TokenType.VariableName]) &&
            ParsedDocument.isPhrase(traverser.parent(), [PhraseType.SimpleVariable]);
    }

    completions(context: Context) {

        let nameResolver = context.createNameResolver();
        let text = ParsedDocument.isToken(context.token, [TokenType.Dollar]) ?
            '$' : nameResolver.tokenText(context.token, context.offset);

        if (!text) {
            return noCompletionResponse;
        }

        let scope = context.scopeSymbol;
        let symbolMask = SymbolKind.Variable | SymbolKind.Parameter;
        let varSymbols = scope.children.filter((x) => {
            return (x.kind & symbolMask) > 0 && x.name.indexOf(text) === 0;
        });
        //also suggest built in globals vars
        Array.prototype.push.apply(varSymbols, context.symbolStore.match(text, this._isBuiltInGlobalVar));

        let limit = Math.min(varSymbols.length, this.maxSuggestions);
        let isIncomplete = varSymbols.length > this.maxSuggestions;

        let items: lsp.CompletionItem[] = [];

        for (let n = 0; n < limit; ++n) {
            items.push(this._toCompletionItem(varSymbols[n]));
        }

        return <lsp.CompletionList>{
            items: items,
            isIncomplete: isIncomplete
        }

    }

    private _isBuiltInGlobalVar(s: PhpSymbol) {
        return s.kind === SymbolKind.Variable && !s.location;
    }

    private _toCompletionItem(s: PhpSymbol) {

        return <lsp.CompletionItem>{
            label: s.name,
            kind: lsp.SymbolKind.Variable,
            documentation: s.description
        }

    }

}

class NameCompletion implements CompletionStrategy {

    private static _statementKeywords = [
        '__halt_compiler',
        'abstract',
        'break',
        'catch',
        'class',
        'const',
        'continue',
        'declare',
        'die',
        'do',
        'echo',
        'else',
        'elseif',
        'enddeclare',
        'endfor',
        'endforeach',
        'endif',
        'endswitch',
        'endwhile',
        'final',
        'finally',
        'for',
        'foreach',
        'function',
        'global',
        'goto',
        'if',
        'interface',
        'list',
        'namespace',
        'return',
        'static',
        'switch',
        'throw',
        'trait',
        'try',
        'unset',
        'use',
        'while'
    ];

    private static _expressionKeywords = [
        'array',
        'clone',
        'empty',
        'eval',
        'exit',
        'function',
        'include',
        'include_once',
        'isset',
        'new',
        'parent',
        'print',
        'require',
        'require_once',
        'static',
        'yield'
    ];

    constructor(public maxSuggestions: number) {

    }

    canSuggest(context: Context) {
        let traverser = context.createTraverser();
        return ParsedDocument.isToken(traverser.node, [TokenType.Backslash, TokenType.Name]) &&
            ParsedDocument.isPhrase(traverser.parent(),
                [PhraseType.FullyQualifiedName, PhraseType.QualifiedName, PhraseType.RelativeQualifiedName]);
    }

    completions(context: Context) {

        let items: lsp.CompletionItem[] = [];
        let traverser = context.createTraverser();
        let nsNameNode = traverser.parent() as NamespaceName;
        let qNameNode = traverser.parent() as Phrase;
        let qNameParent = traverser.parent() as Phrase;
        let nameResolver = context.createNameResolver();
        let text = nameResolver.namespaceNamePhraseText(nsNameNode, context.offset);

        if (!text) {
            return noCompletionResponse;
        }

        if (qNameNode.phraseType === PhraseType.QualifiedName) {
            Array.prototype.push.apply(items, keywordCompletionItems(NameCompletion._expressionKeywords, text));
            if (qNameParent.phraseType === PhraseType.StatementList) {
                Array.prototype.push.apply(items, keywordCompletionItems(NameCompletion._statementKeywords, text));
            }
        }

        if (qNameNode.phraseType === PhraseType.RelativeQualifiedName) {
            text = nameResolver.resolveRelative(text);
        }

        let matches = context.symbolStore.match(text, this._symbolFilter);
        let limit = Math.min(matches.length, this.maxSuggestions - items.length);
        let isIncomplete = matches.length > this.maxSuggestions - items.length;

        for (let n = 0; n < limit; ++n) {
            items.push(toNameCompletionItem(matches[n], nameResolver.namespaceName, qNameNode.phraseType));
        }

        return <lsp.CompletionList>{
            items: items,
            isIncomplete: isIncomplete
        }

    }

    private _symbolFilter(s: PhpSymbol) {
        return (s.kind & (SymbolKind.Class | SymbolKind.Function | SymbolKind.Constant)) > 0 &&
            !(s.modifiers & SymbolModifier.Anonymous);
    }

}

class ScopedAccessCompletion implements CompletionStrategy {

    canSuggest(context: Context) {
        let traverser = context.createTraverser();
        let scopedAccessPhrases = [
            PhraseType.ScopedCallExpression,
            PhraseType.ErrorScopedAccessExpression,
            PhraseType.ScopedMemberName,
            PhraseType.ScopedPropertyAccessExpression
        ];

        if (ParsedDocument.isToken(traverser.node, [TokenType.ColonColon])) {
            return ParsedDocument.isPhrase(traverser.parent(), scopedAccessPhrases);
        }

        if (ParsedDocument.isToken(traverser.node, [TokenType.VariableName])) {
            return ParsedDocument.isPhrase(traverser.parent(), [PhraseType.ScopedMemberName]);
        }

        return ParsedDocument.isPhrase(traverser.parent(), [PhraseType.Identifier]) &&
            ParsedDocument.isPhrase(traverser.parent(), [PhraseType.ScopedMemberName]);
    }

    completions(context: Context) {

        return noCompletionResponse;

    }

}

class MemberAccessCompletion implements CompletionStrategy {

    canSuggest(context: Context) {
        let traverser = context.createTraverser();

        if (ParsedDocument.isToken(traverser.node, [TokenType.Arrow])) {
            return ParsedDocument.isPhrase(traverser.parent(),
                [PhraseType.PropertyAccessExpression, PhraseType.MethodCallExpression]);
        }

        return ParsedDocument.isToken(traverser.node, [TokenType.Name]) &&
            ParsedDocument.isPhrase(traverser.parent(),
                [PhraseType.PropertyAccessExpression, PhraseType.MethodCallExpression]);

    }

    completions(context: Context) {

        return noCompletionResponse;

    }

}


/*

    export function completions(context:DocumentContext) {

        switch ((<Phrase>context.phraseNode.value).phraseType) {
            case PhraseType.NamespaceName:

            case PhraseType.Identifier:

            case PhraseType.Property:
            case PhraseType.MethodCall:

            case PhraseType.ErrorStaticMember:

            case PhraseType.Variable:
                return variable(context);
            default:
                return [];

    }

    function variable(context:DocumentContext){

        let varContext = context.phraseNode.parent;

        (<Phrase>varContext.value).phraseType){
            case PhraseType.StaticProperty:
                return staticPropertyCompletions(context);
            default:
                return variableCompletions(context);
        }


    }

    function staticProperty(context:DocumentContext){

    }


}

class TypeCompletionProvider implements CompletionProvider {

    constructor(public astStore: AstStore, public symbolStore: SymbolStore) { }

    canComplete(context: DocumentContext) {

        return (<Phrase>context.phraseNode.value).phraseType === PhraseType.NamespaceName &&
            (<Phrase>context.phraseNode.parent.value).phraseType !== PhraseType.Namespace;

    }

    completions(context: DocumentContext) {

        let namespaceNameNode = context.phraseNode;
        let nameNode = (<Phrase>namespaceNameNode.parent.value).phraseType === PhraseType.Name ? 
            namespaceNameNode.parent : null;
        let contextNode = this._typeContext(namespaceNameNode);
        let nChars = 1 + context.position.character - (<Phrase>context.phraseNode.value).startToken.range.start.char;
        let text = Ast.namespaceNameToString(context.phraseNode).substr(0, nChars);
        let replaceRange: Range = {
            start: (<Phrase>context.phraseNode.value).startToken.range.start,
            end: context.position
        };

        switch((<Phrase>contextNode.value).phraseType){
            case PhraseType.UseDeclaration:
                return this._useDeclaration(contextNode, text, replaceRange);
            case PhraseType.New:
                return this._new(nameNode, text, replaceRange);
            case PhraseType.CatchNameList:
                return this._catchNames(nameNode, text, replaceRange);
            case PhraseType.Implements:
                return this._implements(nameNode, text, replaceRange);
            case PhraseType.UseTrait:
                return this._useTrait(nameNode, text, replaceRange);
            case PhraseType.BinaryExpression:
                return this._binaryExpression(nameNode, text, replaceRange);        
            case PhraseType.Extends:
                return this._extends(nameNode, text, replaceRange);
            case 
        }

        //new
        //catch name list
        //extends
        //type expr
        //implements
        //use traits
        //static func
        //use
        //instanceof


    }

    private _extends(nameNode:Tree<Phrase|Token>, text:string, replaceRange:Range){

    }

    private _binaryExpression(nameNode:Tree<Phrase|Token>, text:string, replaceRange:Range){

    }

    private _useTrait(nameNode:Tree<Phrase|Token>, text:string, replaceRange:Range){

    }

    private _implements(nameNode:Tree<Phrase|Token>, text:string, replaceRange:Range){

    }

    private _catchNames(nameNode:Tree<Phrase|Token>, text:string, replaceRange:Range){

    }

    private _new(nameNode:Tree<Phrase|Token>, text:string, replaceRange:Range){

    }

    private _useDeclaration(contextNode:Tree<Phrase|Token>, text:string, replaceRange:Range){
        //todo
        return [];
    }

    private _typeContext(namespaceNameNode:Tree<Phrase|Token>){

        let p:Predicate<Tree<Phrase|Token>> = (x) => {

            switch((<Phrase>x.value).phraseType){
                case PhraseType.New:
                case PhraseType.ExtendsClass:
                case PhraseType.TypeExpression:
                case PhraseType.Implements:
                case PhraseType.CatchNameList:
                case PhraseType.BinaryExpression:
                case PhraseType.UseDeclaration:
                case PhraseType.UseTrait:
                case PhraseType.ErrorVariable:
                case PhraseType.Constant:
                case PhraseType.StaticMethodCall:
                case PhraseType.StaticProperty:
                case PhraseType.ClassConstant:
                    return true;
                default:
                    return false;
            }

        }

        return namespaceNameNode.ancestor(p);

    }

}

class MemberCompletionProvider implements CompletionProvider {

    constructor(public astStore: AstStore, public symbolStore: SymbolStore) { }

    canComplete(context: DocumentContext) {

        let token = context.token;
        let phrase = context.phraseNode;

        if (this._isMemberAccessNode(phrase) &&
            (token.tokenType === TokenType.T_PAAMAYIM_NEKUDOTAYIM ||
                token.tokenType === TokenType.T_OBJECT_OPERATOR ||
                token.tokenType === TokenType.T_STRING)) {
            return true;
        }

        if ((<Phrase>phrase.value).phraseType === PhraseType.Identifier &&
            this._isStaticMemberAccessNode(phrase.parent)) {
            return true;
        }

        if ((<Phrase>phrase.value).phraseType === PhraseType.Variable &&
            (this._isStaticMemberAccessNode(phrase.parent) ||
                (token.tokenType === '$' && phrase.parent && this._isStaticMemberAccessNode(phrase.parent.parent)))) {
            return true;
        }

        return false;

    }

    completions(context: DocumentContext) {

        let phrase = context.phraseNode;

        while (!this._isMemberAccessNode(phrase)) {
            phrase = phrase.parent;
        }

        let text = '';
        let prefix = '';
        let token = context.token;
        let replaceRange: Range;

        if (token.tokenType === TokenType.T_STRING ||
            token.tokenType === TokenType.T_VARIABLE ||
            token.tokenType === '$' ||
            (<Phrase>context.phraseNode.value).phraseType === PhraseType.Identifier) {
            let nChars = 1 + context.position.character - token.range.start.char;
            text = token.text.substr(0, nChars);
            replaceRange = { start: token.range.start, end: context.position };
        } else if (token.tokenType === TokenType.T_OBJECT_OPERATOR) {
            prefix = '->';
            replaceRange = token.range;
        } else if (token.tokenType === TokenType.T_OBJECT_OPERATOR) {
            prefix = '::';
            replaceRange = token.range;
        }
        else {
            return [];
        }

        let type = context.typeResolveExpression(phrase[0]);

        if (!type) {
            return [];
        }

        let thisTypeName = context.thisName;
        let baseTypeName = context.thisExtendsName;
        let symbols: Tree<PhpSymbol>[] = [];
        let predicateFactory = this._isInstanceMemberAccessNode(phrase) ?
            this._instanceMembersPredicate : this._staticMemberPredicate;

        //account for parent::
        if (this._isParent(phrase)) {
            predicateFactory = this._parentMemberPredicate;
        }

        type.atomicClassArray().forEach((typeName) => {
            Array.prototype.push.apply(
                symbols,
                this.symbolStore.lookupTypeMembers(typeName, predicateFactory(typeName, thisTypeName, baseTypeName, text)));
        });

        return this._memberSymbolsToCompletionItems(symbols, replaceRange, prefix);


    }

    private _memberSymbolsToCompletionItems(symbols: Tree<PhpSymbol>[], replaceRange: Range, prefix: string) {

        let items: CompletionItem[] = [];
        for (let n = 0; n < symbols.length; ++n) {
            items.push(this._memberSymbolToCompletionItem(symbols[n], replaceRange, prefix));
        }
        return items;

    }

    private _memberSymbolToCompletionItem(symbol: Tree<PhpSymbol>, replaceRange: Range, prefix: string) {

        switch (symbol.value.kind) {
            case SymbolKind.Property:
                return this._propertySymbolToCompletionItem(symbol, replaceRange, prefix);
            case SymbolKind.Method:
                return this._methodSymbolToCompletionItem(symbol, replaceRange, prefix);
            case SymbolKind.Constant:
                return this._constantSymbolToCompletionItem(symbol, replaceRange, prefix);
            default:
                throw new Error('Invalid Argument');
        }

    }

    private _constantSymbolToCompletionItem(symbol: Tree<PhpSymbol>, range: Range, prefix: string) {

        let item: CompletionItem = {
            label: symbol.value.name,
            kind: CompletionItemKind.Value,
            insertText: prefix + symbol.value.name,
            range: range,
        }

        if (symbol.value.description) {
            item.documentation = symbol.value.description;
        }

        return item;

    }

    private _propertySymbolToCompletionItem(symbol: Tree<PhpSymbol>, range: Range, prefix: string) {
        let name = !(symbol.value.modifiers & SymbolModifier.Static) ? symbol.value.name.slice(1) : symbol.value.name;
        let item: CompletionItem = {
            label: name,
            kind: CompletionItemKind.Property,
            insertText: prefix + name,
            range: range
        };

        if (symbol.value.type) {
            item.detail = symbol.value.type.toString();
        }

        if (symbol.value.description) {
            item.documentation = symbol.value.description;
        }

        return item;
    }

    private _methodSymbolToCompletionItem(symbol: Tree<PhpSymbol>, range: Range, prefix: string) {
        let item: CompletionItem = {
            label: symbol.value.name,
            kind: CompletionItemKind.Method,
            insertText: prefix + symbol.value.name,
            range: range,
        };

        if (symbol.value.signature) {
            item.detail = symbol.value.signature;
        }

        if (symbol.value.description) {
            item.documentation = symbol.value.description;
        }

        return item;
    }

    private _isParent(phrase: Tree<Phrase | Token>) {
        return !!phrase.children[0].find((x) => {
            return x.value && (<Token>x.value).text === 'parent' &&
                x.parent.children.length === 1;
        });
    }

    private _instanceMembersPredicate(typeName: string, thisTypeName: string, thisExtendsTypeName: string, text?: string): Predicate<Tree<PhpSymbol>> {
        let predicate: Predicate<Tree<PhpSymbol>>;

        if (typeName === thisTypeName) {
            predicate = SymbolTree.instanceInternalMembersPredicate;
        } else if (typeName === thisExtendsTypeName) {
            predicate = SymbolTree.instanceInheritedMembersPredicate;
        } else {
            predicate = SymbolTree.instanceExternalMembersPredicate;
        }

        if (!text) {
            return predicate;
        }

        return (x) => {
            return predicate(x) && x.value.name.indexOf(text) >= 0;
        }
    }

    private _staticMemberPredicate(typeName: string, thisTypeName: string, thisExtendsTypeName: string, text?: string): Predicate<Tree<PhpSymbol>> {

        let predicate: Predicate<Tree<PhpSymbol>>;

        if (typeName === thisTypeName) {
            predicate = SymbolTree.staticInternalMembersPredicate;
        } else if (typeName === thisExtendsTypeName) {
            predicate = SymbolTree.staticInheritedMembersPredicate;
        } else {
            predicate = SymbolTree.staticExternalMembersPredicate;
        }

        if (!text) {
            return predicate;
        }

        return (x) => {
            return predicate(x) && x.value.name.indexOf(text) >= 0;
        }

    }

    private _parentMemberPredicate(typeName: string, thisTypeName: string, thisExtendsTypeName: string, text?: string): Predicate<Tree<PhpSymbol>> {

        return (x) => {
            return (x.value.kind === SymbolKind.Method ||
                x.value.kind === SymbolKind.Constant ||
                (x.value.kind === SymbolKind.Property &&
                    (x.value.modifiers & SymbolModifier.Static) > 0)) &&
                (x.value.modifiers & (SymbolModifier.Public | SymbolModifier.Protected)) > 0 &&
                !text || x.value.name.indexOf(text) >= 0;

        };
    }

    private _isMemberAccessNode(node: Tree<Phrase | Token>) {

        return this._isInstanceMemberAccessNode(node) ||
            this._isStaticMemberAccessNode(node);
    }

    private _isStaticMemberAccessNode(node: Tree<Phrase | Token>) {
        if (!node.value) {
            return false;
        }

        switch ((<Phrase>node.value).phraseType) {
            case PhraseType.ClassConstant:
            case PhraseType.StaticMethodCall:
            case PhraseType.StaticProperty:
            case PhraseType.ErrorStaticMember:
                return true;
            default:
                return false;
        }
    }

    private _isInstanceMemberAccessNode(node: Tree<Phrase | Token>) {
        return node.value &&
            ((<Phrase>node.value).phraseType === PhraseType.Property ||
                (<Phrase>node.value).phraseType === PhraseType.MethodCall);

    }


}

*/