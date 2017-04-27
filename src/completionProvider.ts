/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */

'use strict';

import {
    Token, TokenType, Phrase, PhraseType,
    NamespaceName, ScopedExpression, ObjectAccessExpression,
    NamespaceUseDeclaration, NamespaceUseGroupClause, MethodDeclarationHeader,
    ClassBaseClause, InterfaceBaseClause, ClassInterfaceClause
} from 'php7parser';
import {
    PhpSymbol, SymbolKind, SymbolModifier, TypeSource
} from './symbol';
import { SymbolStore, SymbolTable, MemberQuery } from './symbolStore';
import { SymbolReader } from './symbolReader';
import { TypeString } from './typeString';
import { NameResolver } from './nameResolver';
import { ExpressionTypeResolver, VariableTypeResolver, VariableTable } from './typeResolver';
import { ParsedDocument, ParsedDocumentStore } from './parsedDocument';
import { Predicate } from './types';
import { Context } from './context';
import * as lsp from 'vscode-languageserver-types';
import * as util from './util';

const noCompletionResponse: lsp.CompletionList = {
    items: [],
    isIncomplete: false
};

function keywordCompletionItems(keywords: string[], text: string) {

    let kw: string;
    let items: lsp.CompletionItem[] = [];
    for (let n = 0, l = keywords.length; n < l; ++n) {

        kw = keywords[n];
        if (util.fuzzyStringMatch(text, kw)) {
            items.push({
                label: kw,
                kind: lsp.CompletionItemKind.Keyword
            });
        }

    }

    return items;

}

function createSignatureHelpCommand(uri: string, position: lsp.Position) {
    return <lsp.Command>{
        command: 'vscode.executeSignatureHelpProvider',
        title: 'Signature Help',
        arguments: [uri, position]
    };
}

function createInsertText(s: PhpSymbol, nsName: string, namePhraseType: PhraseType) {
    let insertText = s.name;

    if (nsName && s.name.indexOf(nsName) === 0 && insertText.length > nsName.length + 1) {
        insertText = insertText.slice(nsName.length + 1);
        if (namePhraseType === PhraseType.RelativeQualifiedName) {
            insertText = 'namespace\\' + insertText;
        }

    } else if (nsName && namePhraseType !== PhraseType.FullyQualifiedName && !(s.modifiers & SymbolModifier.Use)) {
        insertText = '\\' + insertText;
    }
    return insertText;
}

function symbolKindToLspSymbolKind(kind: SymbolKind) {

    switch (kind) {
        case SymbolKind.Class:
            return lsp.SymbolKind.Class;
        case SymbolKind.Function:
            return lsp.SymbolKind.Function;
        case SymbolKind.Constant:
            return lsp.SymbolKind.Constant;
        case SymbolKind.Interface:
            return lsp.CompletionItemKind.Interface;
        case SymbolKind.Namespace:
            return lsp.CompletionItemKind.Module;
        default:
            return lsp.SymbolKind.String;
    }
}

function toClassCompletionItem(s: PhpSymbol, context: Context, namePhraseType: PhraseType) {
    let item = <lsp.CompletionItem>{
        kind: s.kind === SymbolKind.Interface ? lsp.CompletionItemKind.Interface : lsp.CompletionItemKind.Class,
        label: PhpSymbol.notFqn(s.name),
        documentation: s.description,
        insertText: createInsertText(s, context.namespace, namePhraseType)
    }

    if ((s.modifiers & SymbolModifier.Use) > 0 && s.associated && s.associated.length) {
        item.detail = s.associated[0].name;
    } else {
        item.detail = s.name;
    }

    return item;
}

function toFunctionCompletionItem(s: PhpSymbol, context: Context, namePhraseType: PhraseType) {

    let item: lsp.CompletionItem = {
        kind: lsp.CompletionItemKind.Function,
        label: PhpSymbol.notFqn(s.name),
        documentation: s.description,
        detail: PhpSymbol.signatureString(s),
        insertText: createInsertText(s, context.namespace, namePhraseType)
    }

    if (PhpSymbol.hasParameters(s)) {
        item.insertText = snippetEscape(item.insertText) + '($0)';
        let wordPos = context.wordStartPosition;
        item.command = createSignatureHelpCommand(context.uri, lsp.Position.create(wordPos.line, wordPos.character + item.insertText.length + 1));
        item.insertTextFormat = lsp.InsertTextFormat.Snippet;
    } else {
        item.insertText += '()';
    }

    return item;
}

function toMethodCompletionItem(s: PhpSymbol) {

    let item = <lsp.CompletionItem>{
        kind: lsp.CompletionItemKind.Method,
        label: s.name,
        documentation: s.description,
        detail: PhpSymbol.signatureString(s)
    };

    if (s.name.slice(0, 2) === '__') {
        //sort magic methods last
        item.sortText = 'zzz';
    }

    return item;
}

function toClassConstantCompletionItem(s: PhpSymbol) {
    return <lsp.CompletionItem>{
        kind: lsp.CompletionItemKind.Value, //@todo use Constant
        label: s.name,
        documentation: s.description,
        detail: '= ' + s.value
    }
}

function toConstantCompletionItem(s: PhpSymbol, context: Context, namePhraseType: PhraseType) {
    let item = <lsp.CompletionItem>{
        kind: lsp.CompletionItemKind.Value, //@todo use Constant
        label: PhpSymbol.notFqn(s.name),
        documentation: s.description,
        detail: '= ' + s.value,
        insertText: createInsertText(s, context.namespace, namePhraseType)
    }

    return item;
}

function toPropertyCompletionItem(s: PhpSymbol) {
    return <lsp.CompletionItem>{
        kind: lsp.CompletionItemKind.Property,
        label: !(s.modifiers & SymbolModifier.Static) ? s.name.slice(1) : s.name,
        documentation: s.description,
        detail: s.type ? s.type.toString() : ''
    }
}

function toConstructorCompletionItem(s: PhpSymbol, context:Context, namePhraseType:PhraseType) {
    let item = <lsp.CompletionItem>{
        kind: lsp.CompletionItemKind.Constructor,
        label: PhpSymbol.notFqn(s.name),
        documentation: s.description,
        insertText: createInsertText(s, context.namespace, namePhraseType)
    }

    if ((s.modifiers & SymbolModifier.Use) > 0 && s.associated && s.associated.length) {
        item.detail = s.associated[0].name;
    } else {
        item.detail = s.name;
    }

    return item;
}

function toVariableCompletionItem(s: PhpSymbol, varTable: VariableTable) {

    return <lsp.CompletionItem>{
        label: s.name,
        kind: lsp.CompletionItemKind.Variable,
        documentation: s.description,
        detail: varTable.getType(s.name).toString()
    }

}

function toNamespaceCompletionItem(s: PhpSymbol) {
    return <lsp.CompletionItem>{
        label: s.name,
        kind: lsp.SymbolKind.Namespace
    }
}

function uniqueSymbolNames(symbols: PhpSymbol[]) {

    let set = new Set<string>();
    let s: PhpSymbol;
    let unique: PhpSymbol[] = [];
    for (let n = 0, l = symbols.length; n < l; ++n) {
        s = symbols[n];
        if (!set.has(s.name)) {
            unique.push(s);
            set.add(s.name);
        }
    }
    return unique;
}

function tokenToSymbolKind(t: Token) {

    if (!t) {
        return 0;
    }

    switch (t.tokenType) {
        case TokenType.Class:
            return SymbolKind.Class;
        case TokenType.Function:
            return SymbolKind.Function;
        case TokenType.Const:
            return SymbolKind.Constant;
        default:
            return 0;
    }

}

export class CompletionProvider {

    private _maxItems: number;
    private _strategies: CompletionStrategy[];

    constructor(
        public symbolStore: SymbolStore,
        public documentStore: ParsedDocumentStore) {

        this._maxItems = 100;
        this._strategies = [
            new ClassTypeDesignatorCompletion(),
            new ScopedAccessCompletion(),
            new ObjectAccessCompletion(),
            new SimpleVariableCompletion(),
            new TypeDeclarationCompletion(),
            new ClassBaseClauseCompletion(),
            new InterfaceClauseCompletion(),
            new NamespaceDefinitionCompletion(),
            new NamespaceUseClauseCompletion(),
            new NamespaceUseGroupClauseCompletion(),
            new MethodDeclarationHeaderCompletion(),
            new DeclarationBodyCompletion(),
            new NameCompletion()
        ];

    }

    set maxItems(value: number) {
        this._maxItems = value;
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

        return strategy ? strategy.completions(context, this._maxItems) : noCompletionResponse;

    }

}

interface CompletionStrategy {
    canSuggest(context: Context): boolean;
    completions(context: Context, maxItems: number): lsp.CompletionList;

}

abstract class AbstractNameCompletion implements CompletionStrategy {

    abstract canSuggest(context: Context): boolean;

    completions(context: Context, maxItems: number) {

        let items: lsp.CompletionItem[] = [];
        let namePhrase = this._getNamePhrase(context);
        let text = context.word;

        if (!text) {
            return noCompletionResponse;
        }

        //@todo use snippets/command to invoke sugnature help automatically for constructors
        //let wordPos = lsp.Position.create(context.position.line, context.position.character - text.length);

        Array.prototype.push.apply(items, keywordCompletionItems(this._getKeywords(context), text));

        let pred = this._symbolFilter;
        if (namePhrase && namePhrase.phraseType === PhraseType.RelativeQualifiedName) {
            text = text.slice(10); //namespace\
            let ns = context.namespace;
            pred = (x) => {
                return this._symbolFilter && x.name.indexOf(ns) === 0;
            };
        }

        //use directives
        let matches = context.nameResolver.rules.filter(pred);
        Array.prototype.push.apply(matches, uniqueSymbolNames(context.symbolStore.match(text, pred, true)));
        let limit = Math.min(matches.length, maxItems - items.length);
        let isIncomplete = matches.length > maxItems - items.length;

        for (let n = 0; n < limit; ++n) {
            items.push(this._toCompletionItem(matches[n], context, namePhrase.phraseType));
        }

        return <lsp.CompletionList>{
            items: items,
            isIncomplete: isIncomplete
        }

    }

    protected abstract _getKeywords(context: Context): string[];

    protected _toCompletionItem(s: PhpSymbol, context: Context, namePhraseType: PhraseType): lsp.CompletionItem {
        switch (s.kind) {
            case SymbolKind.Class:
            case SymbolKind.Interface:
                return toClassCompletionItem(s, context, namePhraseType);
            case SymbolKind.Function:
                return toFunctionCompletionItem(s, context, namePhraseType);
            case SymbolKind.Constant:
                return toConstantCompletionItem(s, context, namePhraseType);
            case SymbolKind.Namespace:
                return toNamespaceCompletionItem(s);
            default:
                throw new Error('Invalid Argument');
        }
    }

    protected _getNamePhrase(context: Context) {
        return context.createTraverser().ancestor(this._isNamePhrase) as Phrase;
    }

    protected _isNamePhrase(node: Phrase | Token) {
        switch ((<Phrase>node).phraseType) {
            case PhraseType.QualifiedName:
            case PhraseType.FullyQualifiedName:
            case PhraseType.RelativeQualifiedName:
                return true;
            default:
                return false;
        }
    }

    protected abstract _symbolFilter(s: PhpSymbol): boolean;

}

class ClassTypeDesignatorCompletion extends AbstractNameCompletion {

    private static _keywords = [
        'class', 'static', 'namespace'
    ];

    canSuggest(context: Context) {

        let traverser = context.createTraverser();

        return ParsedDocument.isPhrase(traverser.parent(), [PhraseType.NamespaceName]) &&
            ParsedDocument.isPhrase(traverser.parent(),
                [PhraseType.FullyQualifiedName, PhraseType.QualifiedName, PhraseType.RelativeQualifiedName]) &&
            ParsedDocument.isPhrase(traverser.parent(), [PhraseType.ClassTypeDesignator]);

    }

    protected _symbolFilter(s: PhpSymbol) {
        return s.kind === SymbolKind.Class &&
            !(s.modifiers & (SymbolModifier.Anonymous | SymbolModifier.Abstract));
    }

    protected _getKeywords(context: Context) {

        if (context.createTraverser().ancestor(this._isQualifiedName)) {
            return ClassTypeDesignatorCompletion._keywords;
        }
        return [];
    }

    protected _toCompletionItem(s: PhpSymbol, context:Context, namePhraseType:PhraseType) {
        return toConstructorCompletionItem(s, context, namePhraseType);
    }

    private _isQualifiedName(node: Phrase | Token) {
        return (<Phrase>node).phraseType === PhraseType.QualifiedName;
    }

}

class SimpleVariableCompletion implements CompletionStrategy {

    canSuggest(context: Context) {
        let traverser = context.createTraverser();
        return ParsedDocument.isToken(traverser.node, [TokenType.Dollar, TokenType.VariableName]) &&
            ParsedDocument.isPhrase(traverser.parent(), [PhraseType.SimpleVariable]);
    }

    completions(context: Context, maxItems: number) {

        let text = context.word;

        if (!text) {
            return noCompletionResponse;
        }

        let scope = context.scopeSymbol;
        let symbolMask = SymbolKind.Variable | SymbolKind.Parameter;
        let varSymbols = scope.children ? scope.children.filter((x) => {
            return (x.kind & symbolMask) > 0 && x.name.indexOf(text) === 0;
        }) : [];
        //also suggest built in globals vars
        Array.prototype.push.apply(varSymbols, context.symbolStore.match(text, this._isBuiltInGlobalVar));

        let limit = Math.min(varSymbols.length, maxItems);
        let isIncomplete = varSymbols.length > maxItems;

        let items: lsp.CompletionItem[] = [];
        let varTable = context.variableTable;

        for (let n = 0; n < limit; ++n) {
            items.push(toVariableCompletionItem(varSymbols[n], varTable));
        }

        return <lsp.CompletionList>{
            items: items,
            isIncomplete: isIncomplete
        }

    }

    private _isBuiltInGlobalVar(s: PhpSymbol) {
        return s.kind === SymbolKind.Variable && !s.location;
    }



}

class NameCompletion extends AbstractNameCompletion {

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
        'yield',
        'as'
    ];

    private static _openTagCompletion: lsp.CompletionList = {
        isIncomplete: false,
        items: [{
            kind: lsp.CompletionItemKind.Keyword,
            label: '<?php',
            insertText: 'php'
        }]
    }

    private static _extendsRegex = /\b(?:class|interface)\s+[a-zA-Z_\x80-\xff][a-zA-Z0-9_\x80-\xff]*\s+[a-z]+$/;
    private static _implementsRegex = /\bclass\s+[a-zA-Z_\x80-\xff][a-zA-Z0-9_\x80-\xff]*(?:\s+extends\s+[a-zA-Z_\x80-\xff][a-zA-Z0-9_\x80-\xff]*)?\s+[a-z]+$/;

    canSuggest(context: Context) {

        let traverser = context.createTraverser();
        return ParsedDocument.isPhrase(traverser.parent(), [PhraseType.NamespaceName]) &&
            traverser.ancestor(this._isNamePhrase) !== null;
    }

    completions(context: Context, maxItems: number) {

        //<?php (no trailing space) is considered short tag open and then name token
        //dont suggest in this context
        if (context.textBefore(3) === '<?p' ||
            context.textBefore(4) === '<?ph' ||
            context.textBefore(5) === '<?php') {
            return NameCompletion._openTagCompletion;
        }

        //this strategy may get called during parse errors on class/interface declaration
        //when wanting to use extends/implements.
        //suppress name suggestions in this case
        let textBefore = context.textBefore(200);
        if (textBefore.match(NameCompletion._extendsRegex)) {
            return lsp.CompletionList.create([{ kind: lsp.CompletionItemKind.Keyword, label: 'extends' }]);
        }

        if (textBefore.match(NameCompletion._implementsRegex)) {
            return lsp.CompletionList.create([{ kind: lsp.CompletionItemKind.Keyword, label: 'implements' }]);
        }

        return super.completions(context, maxItems);

    }

    protected _getKeywords(context: Context) {
        let kw: string[] = [];
        Array.prototype.push.apply(kw, NameCompletion._expressionKeywords);
        Array.prototype.push.apply(kw, NameCompletion._statementKeywords);
        return kw;
    }

    protected _symbolFilter(s: PhpSymbol) {
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
            PhraseType.ClassConstantAccessExpression,
            PhraseType.ScopedPropertyAccessExpression
        ];

        if (ParsedDocument.isToken(traverser.node, [TokenType.ColonColon])) {
            return ParsedDocument.isPhrase(traverser.parent(), scopedAccessPhrases);
        }

        if (ParsedDocument.isToken(traverser.node, [TokenType.VariableName])) {
            return ParsedDocument.isPhrase(traverser.parent(), [PhraseType.ScopedMemberName]);
        }

        if (ParsedDocument.isToken(traverser.node, [TokenType.Dollar])) {
            return ParsedDocument.isPhrase(traverser.parent(), [PhraseType.SimpleVariable]) &&
                ParsedDocument.isPhrase(traverser.parent(), [PhraseType.ScopedMemberName]);
        }

        return ParsedDocument.isPhrase(traverser.parent(), [PhraseType.Identifier]) &&
            ParsedDocument.isPhrase(traverser.parent(), [PhraseType.ScopedMemberName]);
    }

    completions(context: Context, maxItems: number) {

        let traverser = context.createTraverser();
        let scopedAccessExpr = traverser.ancestor(this._isScopedAccessExpr) as ScopedExpression;
        let accessee = scopedAccessExpr.scope;
        let type = context.resolveExpressionType(<Phrase>accessee);

        let text = context.word;
        let typeNames = type.atomicClassArray();

        if (!typeNames.length) {
            return noCompletionResponse;
        }

        let memberPred = this._createSymbolPredicate(text, SymbolModifier.Private | SymbolModifier.Protected);
        let baseMemberPred = this._createSymbolPredicate(text, SymbolModifier.Private);
        let ownMemberPred = this._createSymbolPredicate(text, 0);
        let memberQueries: MemberQuery[] = [];
        let typeName: string;
        let pred: Predicate<PhpSymbol>;

        for (let n = 0, l = typeNames.length; n < l; ++n) {
            typeName = typeNames[n];

            if (typeName === context.className) {
                pred = ownMemberPred;
            } else if (typeName === context.classBaseName) {
                pred = baseMemberPred;
            } else {
                pred = memberPred;
            }

            memberQueries.push({
                typeName: typeName,
                memberPredicate: pred
            });
        }

        let symbols = uniqueSymbolNames(context.symbolStore.lookupMembersOnTypes(memberQueries));
        let isIncomplete = symbols.length > maxItems;
        let limit = Math.min(symbols.length, maxItems);
        let items: lsp.CompletionItem[] = [];

        for (let n = 0; n < limit; ++n) {
            items.push(this._toCompletionItem(symbols[n]));
        }

        return <lsp.CompletionList>{
            isIncomplete: isIncomplete,
            items: items
        }

    }

    private _toCompletionItem(s: PhpSymbol) {
        switch (s.kind) {
            case SymbolKind.ClassConstant:
                return toClassConstantCompletionItem(s);
            case SymbolKind.Method:
                return toMethodCompletionItem(s);
            case SymbolKind.Property:
                return toPropertyCompletionItem(s);
            default:
                throw Error('Invalid Argument');
        }
    }

    private _createSymbolPredicate(text: string, notVisibilityMask: SymbolModifier) {
        return (s: PhpSymbol) => {
            return (s.kind === SymbolKind.ClassConstant ||
                (s.modifiers & SymbolModifier.Static) > 0) &&
                (!notVisibilityMask || !(s.modifiers & notVisibilityMask)) &&
                util.fuzzyStringMatch(text, s.name);
        };
    }

    private _isScopedAccessExpr(node: Phrase | Token) {
        switch ((<Phrase>node).phraseType) {
            case PhraseType.ScopedCallExpression:
            case PhraseType.ErrorScopedAccessExpression:
            case PhraseType.ClassConstantAccessExpression:
            case PhraseType.ScopedPropertyAccessExpression:
                return true;
            default:
                return false;
        }
    }

}

class ObjectAccessCompletion implements CompletionStrategy {

    canSuggest(context: Context) {
        let traverser = context.createTraverser();

        if (ParsedDocument.isToken(traverser.node, [TokenType.Arrow])) {
            return ParsedDocument.isPhrase(traverser.parent(),
                [PhraseType.PropertyAccessExpression, PhraseType.MethodCallExpression]);
        }

        return ParsedDocument.isPhrase(traverser.parent(), [PhraseType.MemberName]);

    }

    completions(context: Context, maxItems: number) {

        let traverser = context.createTraverser();
        let objAccessExpr = traverser.ancestor(this._isMemberAccessExpr) as ObjectAccessExpression;
        let type = context.resolveExpressionType(<Phrase>objAccessExpr.variable);
        let typeNames = type.atomicClassArray();
        let text = context.word;

        if (!typeNames.length) {
            return noCompletionResponse;
        }

        let memberPred = this._createMembersPredicate(text);
        let basePred = this._createBaseMembersPredicate(text);
        let ownPred = this._createOwnMembersPredicate(text);
        let typeName: string;
        let pred: Predicate<PhpSymbol>;
        let memberQueries: MemberQuery[] = [];

        for (let n = 0, l = typeNames.length; n < l; ++n) {
            typeName = typeNames[n];

            if (typeName === context.className) {
                pred = ownPred;
            } else if (typeName === context.classBaseName) {
                pred = basePred;
            } else {
                pred = memberPred;
            }

            memberQueries.push({
                typeName: typeName,
                memberPredicate: pred
            });
        }

        let symbols = uniqueSymbolNames(context.symbolStore.lookupMembersOnTypes(memberQueries));
        let isIncomplete = symbols.length > maxItems;
        let limit = Math.min(symbols.length, maxItems);
        let items: lsp.CompletionItem[] = [];

        for (let n = 0; n < limit; ++n) {
            items.push(this._toCompletionItem(symbols[n]));
        }

        return <lsp.CompletionList>{
            isIncomplete: isIncomplete,
            items: items
        }


    }

    private _toCompletionItem(s: PhpSymbol) {

        switch (s.kind) {
            case SymbolKind.Method:
                return toMethodCompletionItem(s);
            case SymbolKind.Property:
                return toPropertyCompletionItem(s);
            default:
                throw new Error('Invalid Argument');

        }

    }


    private _createMembersPredicate(text: string) {
        return (s: PhpSymbol) => {
            return (s.kind & (SymbolKind.Method | SymbolKind.Property)) > 0 &&
                !(s.modifiers & (SymbolModifier.Private | SymbolModifier.Protected | SymbolModifier.Static)) &&
                util.fuzzyStringMatch(text, s.name);
        };
    }

    private _createBaseMembersPredicate(text: string) {
        return (s: PhpSymbol) => {
            return (s.kind & (SymbolKind.Method | SymbolKind.Property)) > 0 &&
                !(s.modifiers & (SymbolModifier.Private | SymbolModifier.Static)) &&
                util.fuzzyStringMatch(text, s.name);
        };
    }

    private _createOwnMembersPredicate(text: string) {
        return (s: PhpSymbol) => {
            return (s.kind & (SymbolKind.Method | SymbolKind.Property)) > 0 &&
                !(s.modifiers & SymbolModifier.Static) &&
                util.fuzzyStringMatch(text, s.name);
        };
    }

    private _isMemberAccessExpr(node: Phrase | Token) {
        switch ((<Phrase>node).phraseType) {
            case PhraseType.PropertyAccessExpression:
            case PhraseType.MethodCallExpression:
                return true;
            default:
                return false;
        }
    }

}

class TypeDeclarationCompletion extends AbstractNameCompletion {

    private static _keywords = [
        'self', 'array', 'callable', 'bool', 'float', 'int', 'string'
    ];

    canSuggest(context: Context) {
        return ParsedDocument.isToken(context.token, [TokenType.Name, TokenType.Backslash, TokenType.Array, TokenType.Callable]) &&
            context.createTraverser().ancestor((x) => {
                return (<Phrase>x).phraseType === PhraseType.TypeDeclaration;
            }) !== null;
    }

    protected _toCompletionItem(s: PhpSymbol, context:Context, namePhraseType:PhraseType) {
        return toClassCompletionItem(s, context, namePhraseType);
    }

    protected _getKeywords(context: Context) {
        return TypeDeclarationCompletion._keywords;
    }

    protected _symbolFilter(s: PhpSymbol) {
        return (s.kind & (SymbolKind.Class | SymbolKind.Interface)) > 0;
    }

}

class ClassBaseClauseCompletion extends AbstractNameCompletion {

    canSuggest(context: Context) {
        return context.createTraverser().ancestor(this._isClassBaseClause) !== null;
    }

    protected _getKeywords(context: Context) {
        return [];
    }

    protected _symbolFilter(s: PhpSymbol) {
        return s.kind === SymbolKind.Class &&
            !(s.modifiers & SymbolModifier.Final);
    }

    protected _toCompletionItem(s: PhpSymbol, context:Context, namePhraseType:PhraseType) {
        return toClassCompletionItem(s, context, namePhraseType);
    }

    private _isClassBaseClause(node: Phrase | Token) {
        return (<Phrase>node).phraseType === PhraseType.ClassBaseClause;
    }

}

class InterfaceClauseCompletion extends AbstractNameCompletion {

    canSuggest(context: Context) {
        return context.createTraverser().ancestor(this._isInterfaceClause) !== null;

    }

    protected _getKeywords() {
        return [];
    }

    protected _symbolFilter(s: PhpSymbol) {
        return s.kind === SymbolKind.Interface;
    }

    protected _toCompletionItem(s: PhpSymbol, context:Context, namePhraseType:PhraseType) {
        return toClassCompletionItem(s, context, namePhraseType);
    }

    private _isInterfaceClause(node: Phrase | Token) {
        return (<Phrase>node).phraseType === PhraseType.ClassInterfaceClause ||
            (<Phrase>node).phraseType === PhraseType.InterfaceBaseClause;
    }

}

class NamespaceDefinitionCompletion implements CompletionStrategy {

    canSuggest(context: Context) {

        return context.createTraverser().ancestor(this._isNamespaceDefinition) !== null;

    }

    completions(context: Context, maxItems: number) {
        let items: lsp.CompletionItem[] = [];
        let text = context.word;

        let matches = uniqueSymbolNames(context.symbolStore.match(text, this._symbolFilter, true));
        let limit = Math.min(matches.length, maxItems - items.length);
        let isIncomplete = matches.length > maxItems - items.length;

        for (let n = 0; n < limit; ++n) {
            items.push(toNamespaceCompletionItem(matches[n]));
        }

        return <lsp.CompletionList>{
            items: items,
            isIncomplete: isIncomplete
        }

    }

    private _symbolFilter(s: PhpSymbol) {
        return s.kind === SymbolKind.Namespace;
    }

    private _isNamespaceDefinition(node: Phrase | Token) {
        return (<Phrase>node).phraseType === PhraseType.NamespaceDefinition;
    }


}

class NamespaceUseClauseCompletion implements CompletionStrategy {


    canSuggest(context: Context) {
        return context.createTraverser().ancestor(this._isNamespaceUseClause) !== null;
    }

    completions(context: Context, maxItems: number) {

        let items: lsp.CompletionItem[] = [];
        let text = context.word;
        let namespaceUseDecl = context.createTraverser().ancestor(this._isNamespaceUseDeclaration) as NamespaceUseDeclaration;

        if (!text) {
            return noCompletionResponse;
        }

        let kind = tokenToSymbolKind(namespaceUseDecl.kind) || (SymbolKind.Class | SymbolKind.Namespace | SymbolKind.Interface);
        let pred = (x: PhpSymbol) => {
            return (x.kind & kind) > 0 && !(x.modifiers & SymbolModifier.Use);
        }

        let matches = uniqueSymbolNames(context.symbolStore.match(text, pred, true).slice(0, maxItems));
        for (let n = 0, l = matches.length; n < l; ++n) {
            items.push(this._toCompletionItem(matches[n]));
        }

        return <lsp.CompletionList>{
            isIncomplete: matches.length === maxItems,
            items: items
        }

    }

    private _toCompletionItem(s:PhpSymbol){
        let item = lsp.CompletionItem.create(PhpSymbol.notFqn(s.name));
        item.insertText = s.name;
        item.documentation = s.description;
        item.kind = symbolKindToLspSymbolKind(s.kind);
        return item;
    }

    private _isNamespaceUseDeclaration(node: Phrase | Token) {
        return (<Phrase>node).phraseType === PhraseType.NamespaceUseDeclaration;
    }

    private _isNamespaceUseClause(node: Phrase | Token) {
        return (<Phrase>node).phraseType === PhraseType.NamespaceUseClause;
    }

}

class NamespaceUseGroupClauseCompletion implements CompletionStrategy {

    canSuggest(context: Context) {
        return context.createTraverser().ancestor(this._isNamespaceUseGroupClause) !== null;
    }

    completions(context: Context, maxItems: number) {

        let items: lsp.CompletionItem[] = [];
        let text = context.word;
        if (!text) {
            return noCompletionResponse;
        }

        let traverser = context.createTraverser();
        let nsUseGroupClause = traverser.ancestor(this._isNamespaceUseGroupClause) as NamespaceUseGroupClause;
        let nsUseDecl = traverser.ancestor(this._isNamespaceUseDeclaration) as NamespaceUseDeclaration;
        let kind = tokenToSymbolKind(nsUseGroupClause.kind || nsUseDecl.kind) || SymbolKind.Class;
        let prefix = context.nodeText(nsUseDecl.prefix);

        let pred = (x) => {
            return (x.kind & kind) > 0 && !(x.modifiers & SymbolModifier.Use) && (!prefix || x.name.indexOf(prefix) === 0);
        };

        let matches = context.symbolStore.match(text, pred, true).slice(0, maxItems);
        for (let n = 0, l = matches.length; n < l; ++n) {
            items.push(this._toCompletionItem(matches[n], matches[n].name.slice(prefix.length + 1))); //+1 for \
        }

        return <lsp.CompletionList>{
            isIncomplete: matches.length === maxItems,
            items: items
        }

    }

    private _toCompletionItem(s:PhpSymbol, insertText:string){
        let item = lsp.CompletionItem.create(PhpSymbol.notFqn(s.name));
        item.insertText = insertText;
        item.documentation = s.description;
        item.kind = symbolKindToLspSymbolKind(s.kind);
        return item;
    }

    private _isNamespaceUseGroupClause(node: Phrase | Token) {
        return (<Phrase>node).phraseType === PhraseType.NamespaceUseGroupClause;
    }

    private _isNamespaceUseDeclaration(node: Phrase | Token) {
        return (<Phrase>node).phraseType === PhraseType.NamespaceUseDeclaration;
    }

}

class DeclarationBodyCompletion implements CompletionStrategy {

    private static _phraseTypes = [
        PhraseType.ClassDeclarationBody, PhraseType.InterfaceDeclarationBody, PhraseType.TraitDeclarationBody,
        PhraseType.ErrorClassMemberDeclaration
    ];

    private static _keywords = [
        'var', 'public', 'private', 'protected', 'final', 'function', 'abstract', 'implements', 'extends'
    ];

    canSuggest(context: Context) {
        return ParsedDocument.isPhrase(context.createTraverser().parent(), DeclarationBodyCompletion._phraseTypes);
    }

    completions(context: Context, maxItems: number) {
        let text = context.word;
        return <lsp.CompletionList>{
            items: keywordCompletionItems(DeclarationBodyCompletion._keywords, text)
        }
    }

}

class MethodDeclarationHeaderCompletion implements CompletionStrategy {

    canSuggest(context: Context) {
        let traverser = context.createTraverser();
        let thisSymbol = context.classSymbol;
        return ParsedDocument.isPhrase(traverser.parent(), [PhraseType.Identifier]) &&
            ParsedDocument.isPhrase(traverser.parent(), [PhraseType.MethodDeclarationHeader]) &&
            !!thisSymbol && !!thisSymbol.associated && thisSymbol.associated.length > 0;
    }

    completions(context: Context, maxItems: number) {

        let text = context.word;
        let memberDecl = context.createTraverser().ancestor((x) => {
            return (<Phrase>x).phraseType === PhraseType.MethodDeclarationHeader;
        }) as MethodDeclarationHeader;

        let modifiers = SymbolReader.modifierListElementsToSymbolModifier(memberDecl.modifierList ? memberDecl.modifierList.elements : []);
        modifiers &= (SymbolModifier.Public | SymbolModifier.Protected);

        let existingMethodNames: string[] = [];
        if (context.classSymbol.children) {
            existingMethodNames = context.classSymbol.children.filter((x) => {
                return x.kind === SymbolKind.Method;
            }).map((x) => {
                return x.name;
            });
        }

        let classPred = (x: PhpSymbol) => {
            return x.kind === SymbolKind.Method &&
                (!modifiers || (x.modifiers & modifiers) > 0) &&
                !(x.modifiers & (SymbolModifier.Final | SymbolModifier.Private)) &&
                existingMethodNames.indexOf(x.name) < 0 &&
                util.fuzzyStringMatch(text, x.name);
        }

        let interfacePred = (x: PhpSymbol) => {
            return x.kind === SymbolKind.Method &&
                existingMethodNames.indexOf(x.name) < 0 &&
                util.fuzzyStringMatch(text, x.name);
        }

        let queries = context.classSymbol.associated.filter((x) => {
            return (x.kind & (SymbolKind.Class | SymbolKind.Interface)) > 0;
        }).map<MemberQuery>((x) => {
            return {
                typeName: x.name,
                memberPredicate: x.kind === SymbolKind.Interface ? interfacePred : classPred
            };
        });

        let matches = context.symbolStore.lookupMembersOnTypes(queries).slice(0, maxItems);
        let items: lsp.CompletionItem[] = [];
        for (let n = 0, l = matches.length; n < l; ++n) {
            items.push(this._toCompletionItem(matches[n]));
        }

        return <lsp.CompletionList>{
            isIncomplete: matches.length === maxItems,
            items: items
        }

    }

    private _toCompletionItem(s: PhpSymbol) {

        let params = s.children ? s.children.filter((x) => {
            return x.kind === SymbolKind.Parameter;
        }) : [];

        let paramStrings: string[] = [];
        for (let n = 0, l = params.length; n < l; ++n) {
            paramStrings.push(this._parameterToString(params[n]));
        }

        let paramString = paramStrings.join(', ');
        let escapedParamString = snippetEscape(paramString);
        let insertText = `${s.name}(${escapedParamString}) {$0}`;

        let item: lsp.CompletionItem = {
            kind: lsp.CompletionItemKind.Method,
            label: s.name,
            insertText: insertText,
            insertTextFormat: lsp.InsertTextFormat.Snippet,
            documentation: s.description,
            detail: s.scope
        };

        return item;

    }

    private _parameterToString(s: PhpSymbol) {

        let parts: String[] = [];

        if (s.type && !s.type.isEmpty() && s.typeSource === TypeSource.TypeDeclaration) {
            let typeName = s.type.atomicClassArray().shift();
            if (typeName) {
                typeName = '\\' + typeName;
            } else {
                typeName = s.type.toString();
            }
            parts.push(typeName);
        }

        parts.push(s.name);
        if (s.value) {
            parts.push(`= ${s.value}`);
        }

        return parts.join(' ');

    }

}

const snippetEscapeRegex = /[${\\]/g;

function snippetEscape(text: string) {
    return text.replace(snippetEscapeRegex, snippetEscapeReplacer);
}

function snippetEscapeReplacer(match: string, offset: number, subject: string) {
    return '\\' + match;
}
