/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */

'use strict';

import {
    Token, TokenType, Phrase, PhraseType,
    NamespaceName, ScopedExpression, ObjectAccessExpression
} from 'php7parser';
import {
    PhpSymbol, SymbolStore, SymbolTable, SymbolKind, SymbolModifier,
    TypeString, NameResolver, ExpressionTypeResolver, VariableTypeResolver,
    MemberQuery
} from './symbol';
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

function nameLabel(s: PhpSymbol, nsName: string, namePhraseType: PhraseType) {
    let label = s.name;
    if (nsName && s.name.indexOf(nsName) === 0 && label.length > nsName.length + 1) {
        label = label.slice(nsName.length + 1);
    } else if (nsName && namePhraseType !== PhraseType.FullyQualifiedName && !(s.modifiers & SymbolModifier.Use)) {
        label = '\\' + label;
    }
    return label;
}

function toNameCompletionItem(s: PhpSymbol, namespace: string, namePhraseType: PhraseType) {

    let label = nameLabel(s, namespace, namePhraseType);

    switch (s.kind) {
        case SymbolKind.Class:
            return toClassCompletionItem(s, label);
        case SymbolKind.Function:
            return toFunctionCompletionItem(s, label);
        case SymbolKind.Constant:
            return toConstantCompletionItem(s, label);
        default:
            throw new Error('Invalid Argument');
    }

}

function symbolKindToLspSymbolKind(kind: SymbolKind) {

    switch (kind) {
        case SymbolKind.Class:
            return lsp.SymbolKind.Class;
        case SymbolKind.Function:
            return lsp.SymbolKind.Function;
        case SymbolKind.Constant:
            return lsp.SymbolKind.Constant;
        default:
            return lsp.SymbolKind.String;
    }
}

function toClassCompletionItem(s: PhpSymbol, label?: string) {
    return <lsp.CompletionItem>{
        kind: lsp.CompletionItemKind.Class,
        label: label ? label : s.name,
        documentation: s.description
    }
}

function toFunctionCompletionItem(s: PhpSymbol, label?: string) {

    let item: lsp.CompletionItem = {
        kind: lsp.CompletionItemKind.Function,
        label: label ? label : s.name,
        documentation: s.description,
        detail: PhpSymbol.signatureString(s)
    }

    return item;
}

function toMethodCompletionItem(s: PhpSymbol) {
    return <lsp.CompletionItem>{
        kind: lsp.CompletionItemKind.Method,
        label: s.name,
        documentation: s.description,
        detail: PhpSymbol.signatureString(s)
    }
}

function toClassConstantCompletionItem(s: PhpSymbol) {
    return <lsp.CompletionItem>{
        kind: lsp.CompletionItemKind.Value, //@todo use Constant
        label: s.name,
        documentation: s.description,
        detail: s.value
    }
}

function toConstantCompletionItem(s: PhpSymbol, label?: string) {
    return <lsp.CompletionItem>{
        kind: lsp.CompletionItemKind.Value, //@todo use Constant
        label: label ? label : s.name,
        documentation: s.description,
        detail: s.value
    }
}

function toPropertyCompletionItem(s: PhpSymbol) {
    return <lsp.CompletionItem>{
        kind: lsp.CompletionItemKind.Property,
        label: !(s.modifiers & SymbolModifier.Static) ? s.name.slice(1) : s.name,
        documentation: s.description,
        detail: s.type ? s.type.toString() : ''
    }
}

function toConstructorCompletionItem(s: PhpSymbol, label?: string) {
    return <lsp.CompletionItem>{
        kind: lsp.CompletionItemKind.Constructor,
        label: label ? label : s.name,
        documentation: s.description
    }
}

function toVariableCompletionItem(s: PhpSymbol) {

    return <lsp.CompletionItem>{
        label: s.name,
        kind: lsp.SymbolKind.Variable,
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
            new ScopedAccessCompletion(this.symbolStore, maxSuggestions),
            new ObjectAccessCompletion(this.symbolStore, this.maxSuggestions),
            new SimpleVariableCompletion(maxSuggestions),
            new NameCompletion(this.maxSuggestions)
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
        'class', 'static', 'namespace'
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
        let text = context.word;
        if (!text) {
            return noCompletionResponse;
        }

        if (qNameNode.phraseType === PhraseType.QualifiedName) {
            Array.prototype.push.apply(items, keywordCompletionItems(ClassTypeDesignatorCompletion._keywords, text));

        }

        if (qNameNode.phraseType === PhraseType.RelativeQualifiedName) {
            text = context.resolveFqn(qNameNode, SymbolKind.Class);
        }

        let matches = context.symbolStore.match(text, this._symbolFilter);

        let limit = Math.min(matches.length, this.maxSuggestions - items.length);
        let isIncomplete = matches.length > this.maxSuggestions - items.length;

        for (let n = 0; n < limit; ++n) {
            items.push(toConstructorCompletionItem(matches[n], nameLabel(matches[n], context.namespaceName, qNameNode.phraseType)));
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
        let text = context.word;

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
            items.push(toVariableCompletionItem(varSymbols[n]));
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
            ParsedDocument.isPhrase(traverser.parent(), [PhraseType.NamespaceName]) &&
            ParsedDocument.isPhrase(traverser.parent(),
                [PhraseType.FullyQualifiedName, PhraseType.QualifiedName, PhraseType.RelativeQualifiedName]);
    }

    completions(context: Context) {

        //<?php (no trailing space) is considered short tag open and then name token
        //dont suggest in this context
        if (context.textBefore(3) === '<?p' || 
            context.textBefore(4) === '<?ph' ||
            context.textBefore(5) === '<?php') {
            return noCompletionResponse;
        }

        let items: lsp.CompletionItem[] = [];
        let traverser = context.createTraverser();
        let nsNameNode = traverser.parent() as NamespaceName;
        let qNameNode = traverser.parent() as Phrase;
        let qNameParent = traverser.parent() as Phrase;
        let text = context.word;

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
            text = context.resolveFqn(qNameNode, SymbolKind.Class);
        }

        let matches = context.symbolStore.match(text, this._symbolFilter);
        let limit = Math.min(matches.length, this.maxSuggestions - items.length);
        let isIncomplete = matches.length > this.maxSuggestions - items.length;

        for (let n = 0; n < limit; ++n) {
            items.push(toNameCompletionItem(matches[n], context.namespaceName, qNameNode.phraseType));
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

    constructor(public symbolStore: SymbolStore, public maxSuggestions: number) {

    }

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

    completions(context: Context) {

        let traverser = context.createTraverser();
        let scopedAccessExpr = traverser.ancestor(this._isScopedAccessExpr) as ScopedExpression;
        let accessee = scopedAccessExpr.scope;
        let type = context.resolveExpressionType(<Phrase>accessee);

        let text = context.word;
        let typeNames = type.atomicClassArray();

        if (!typeNames.length) {
            return noCompletionResponse;
        }

        let memberPred = this._createMembersPredicate(text);
        let baseMemberPred = this._createBaseMembersPredicate(text);
        let ownMemberPred = this._createOwnMembersPredicate(text);
        let memberQueries: MemberQuery[] = [];
        let typeName: string;
        let pred: Predicate<PhpSymbol>;

        for (let n = 0, l = typeNames.length; n < l; ++n) {
            typeName = typeNames[n];

            if (typeName === context.thisName) {
                pred = ownMemberPred;
            } else if (typeName === context.thisBaseName) {
                pred = baseMemberPred;
            } else {
                pred = memberPred;
            }

            memberQueries.push({
                typeName: typeName,
                memberPredicate: pred
            });
        }

        let symbols = this.symbolStore.lookupMembersOnTypes(memberQueries);
        let isIncomplete = symbols.length > this.maxSuggestions;
        let limit = Math.min(symbols.length, this.maxSuggestions);
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

    private _createMembersPredicate(text: string) {
        return (s: PhpSymbol) => {
            return (((s.kind & (SymbolKind.Method | SymbolKind.Property)) > 0 &&
                (s.modifiers & SymbolModifier.Static) > 0) ||
                s.kind === SymbolKind.ClassConstant) &&
                !(s.modifiers & (SymbolModifier.Private | SymbolModifier.Protected)) &&
                util.fuzzyStringMatch(text, s.name);
        };
    }

    private _createBaseMembersPredicate(text: string) {
        return (s: PhpSymbol) => {
            return (((s.kind & (SymbolKind.Method | SymbolKind.Property)) > 0 &&
                (s.modifiers & SymbolModifier.Static) > 0) ||
                s.kind === SymbolKind.ClassConstant) &&
                !(s.modifiers & SymbolModifier.Private) &&
                util.fuzzyStringMatch(text, s.name);
        };
    }

    private _createOwnMembersPredicate(text: string) {
        return (s: PhpSymbol) => {
            return (((s.kind & (SymbolKind.Method | SymbolKind.Property)) > 0 &&
                (s.modifiers & SymbolModifier.Static) > 0) ||
                s.kind === SymbolKind.ClassConstant) &&
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

    constructor(public symbolStore: SymbolStore, public maxSuggestions: number) { }

    canSuggest(context: Context) {
        let traverser = context.createTraverser();

        if (ParsedDocument.isToken(traverser.node, [TokenType.Arrow])) {
            return ParsedDocument.isPhrase(traverser.parent(),
                [PhraseType.PropertyAccessExpression, PhraseType.MethodCallExpression]);
        }

        return ParsedDocument.isToken(traverser.node, [TokenType.Name]) &&
            ParsedDocument.isPhrase(traverser.parent(), [PhraseType.MemberName]);

    }

    completions(context: Context) {

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

            if (typeName === context.thisName) {
                pred = ownPred;
            } else if (typeName === context.thisBaseName) {
                pred = basePred;
            } else {
                pred = memberPred;
            }

            memberQueries.push({
                typeName: typeName,
                memberPredicate: pred
            });
        }

        let symbols = this.symbolStore.lookupMembersOnTypes(memberQueries);
        let isIncomplete = symbols.length > this.maxSuggestions;
        let limit = Math.min(symbols.length, this.maxSuggestions);
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
                !(s.modifiers & SymbolModifier.Private | SymbolModifier.Static) &&
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
