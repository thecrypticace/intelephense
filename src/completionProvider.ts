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
            return lsp.CompletionItemKind.Class;
        case SymbolKind.Function:
            return lsp.CompletionItemKind.Function;
        case SymbolKind.Constant:
            return lsp.CompletionItemKind.Value;
        case SymbolKind.Interface:
            return lsp.CompletionItemKind.Interface;
        case SymbolKind.Namespace:
            return lsp.CompletionItemKind.Module;
        default:
            return lsp.SymbolKind.String;
    }
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
    let item = <lsp.CompletionItem>{
        kind: lsp.CompletionItemKind.Value, //@todo use Constant
        label: s.name,
        documentation: s.description,
    };

    if(s.value) {
        item.detail = '= ' + s.value;
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

function toVariableCompletionItem(s: PhpSymbol, varTable: VariableTable) {

    return <lsp.CompletionItem>{
        label: s.name,
        kind: lsp.CompletionItemKind.Variable,
        documentation: s.description,
        detail: varTable.getType(s.name).toString()
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

export interface CompletionProviderConfig {
    maxItems: number
}

export class CompletionProvider {

    private _maxItems: number;
    private _strategies: CompletionStrategy[];
    private _config: CompletionProviderConfig;
    private static _defaultConfig: CompletionProviderConfig = { maxItems: 100 };

    constructor(
        public symbolStore: SymbolStore,
        public documentStore: ParsedDocumentStore,
        config?: CompletionProviderConfig) {

        this._config = config ? config : CompletionProvider._defaultConfig;
        this._strategies = [
            new ClassTypeDesignatorCompletion(this._config),
            new ScopedAccessCompletion(this._config),
            new ObjectAccessCompletion(this._config),
            new SimpleVariableCompletion(this._config),
            new TypeDeclarationCompletion(this._config),
            new ClassBaseClauseCompletion(this._config),
            new InterfaceClauseCompletion(this._config),
            new NamespaceDefinitionCompletion(this._config),
            new NamespaceUseClauseCompletion(this._config),
            new NamespaceUseGroupClauseCompletion(this._config),
            new MethodDeclarationHeaderCompletion(this._config),
            new DeclarationBodyCompletion(this._config),
            new NameCompletion(this._config)
        ];

    }

    set config(config: CompletionProviderConfig) {
        this._config = config;
        for (let n = 0, l = this._strategies.length; n < l; ++n) {
            this._strategies[n].config = config;
        }
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

}

interface CompletionStrategy {
    config: CompletionProviderConfig;
    canSuggest(context: Context): boolean;
    completions(context: Context): lsp.CompletionList;
}

abstract class AbstractNameCompletion implements CompletionStrategy {

    constructor(public config: CompletionProviderConfig) { }

    abstract canSuggest(context: Context): boolean;

    completions(context: Context) {

        let items: lsp.CompletionItem[] = [];
        let namePhrase = this._getNamePhrase(context);
        let text = context.word;

        if (!text) {
            return noCompletionResponse;
        }

        let pred = this._symbolFilter;
        if (namePhrase && namePhrase.phraseType === PhraseType.RelativeQualifiedName) {
            //symbols share current namespace
            text = text.slice(10); //namespace\
            let ns = context.namespace;
            let sf = this._symbolFilter;
            pred = (x) => {
                return sf(x) && x.name.indexOf(ns) === 0;
            };
        }

        let matches = context.symbolStore.match(text, pred, true);
        if (namePhrase && namePhrase.phraseType === PhraseType.QualifiedName) {
            //keywords and imports
             Array.prototype.push.apply(items, keywordCompletionItems(this._getKeywords(context), text));
             let imports = this._importedSymbols(context, pred, text);
             matches = this._mergeSymbols(matches, imports);
        }

        let limit = Math.min(matches.length, this.config.maxItems - items.length);
        let isIncomplete = matches.length > this.config.maxItems - items.length;

        for (let n = 0; n < limit; ++n) {
            items.push(this._toCompletionItem(matches[n], context, namePhrase.phraseType));
        }

        return <lsp.CompletionList>{
            items: items,
            isIncomplete: isIncomplete
        }

    }

    protected abstract _getKeywords(context: Context): string[];

    protected _importedSymbols(context:Context, pred:Predicate<PhpSymbol>, text:string) {

        let filteredRules:PhpSymbol[] = [];
        let r:PhpSymbol;
        let rules = context.nameResolver.rules;
        for(let n =0, l = rules.length; n < l; ++n) {
            r = rules[n];
            if(r.associated && r.associated.length > 0 && util.fuzzyStringMatch(text, r.name)) {
                filteredRules.push(r);
            }
        }

        //lookup associated symbol
        let s:PhpSymbol;
        let merged:PhpSymbol;
        let imported:PhpSymbol[] = [];
        for(let n = 0, l = filteredRules.length; n < l; ++n) {
            r = filteredRules[n];
            s = context.symbolStore.find(r.associated[0].name, pred);
            if(s){
                merged = PhpSymbol.clone(s);
                merged.associated = r.associated;
                merged.modifiers |= SymbolModifier.Use;
                merged.name = r.name;
                imported.push(merged);
            }
        }
        return imported;
    }

    protected _toCompletionItem(s: PhpSymbol, context: Context, namePhraseType: PhraseType): lsp.CompletionItem {

        let item = <lsp.CompletionItem>{
            kind: lsp.CompletionItemKind.Class,
            label: PhpSymbol.notFqn(s.name),
            documentation: s.description,
            insertText: createInsertText(s, context.namespace, namePhraseType)
        }

        switch (s.kind) {

            case SymbolKind.Interface:
                item.kind = lsp.CompletionItemKind.Interface;
            //fall though
            case SymbolKind.Class:
                if ((s.modifiers & SymbolModifier.Use) > 0 && s.associated && s.associated.length) {
                    item.detail = s.associated[0].name;
                } else {
                    item.detail = s.name;
                }
                break;

            case SymbolKind.Constant:
                item.kind = lsp.CompletionItemKind.Value;
                if(s.value) {
                    item.detail = s.value;
                }
                break;

            case SymbolKind.Function:
                item.kind = lsp.CompletionItemKind.Function;
                item.detail = PhpSymbol.signatureString(s);
                break;

            case SymbolKind.Namespace:
                return <lsp.CompletionItem>{
                    label: s.name,
                    kind: lsp.CompletionItemKind.Module
                }

            default:
                throw new Error('Invalid Argument');

        }

        return item;

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

    protected _mergeSymbols(matches: PhpSymbol[], imports: PhpSymbol[]) {

        let merged: PhpSymbol[] = imports.slice(0);
        let map: { [index: string]: PhpSymbol } = {};
        let imported: PhpSymbol;
        let s: PhpSymbol;

        for (let n = 0, l = imports.length; n < l; ++n) {
            imported = imports[n];
            if (imported.associated && imported.associated.length) {
                map[imported.associated[0].name] = imported;
            }
        }

        for (let n = 0, l = matches.length; n < l; ++n) {
            s = matches[n];
            imported = map[s.name];
            if (!imported) {
                merged.push(s);
            }
        }

        return merged;
    }

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

    protected _toCompletionItem(s: PhpSymbol, context: Context, namePhraseType: PhraseType) {

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

    private _isQualifiedName(node: Phrase | Token) {
        return (<Phrase>node).phraseType === PhraseType.QualifiedName;
    }

}

class SimpleVariableCompletion implements CompletionStrategy {

    constructor(public config: CompletionProviderConfig) { }

    canSuggest(context: Context) {
        let traverser = context.createTraverser();
        return ParsedDocument.isToken(traverser.node, [TokenType.Dollar, TokenType.VariableName]) &&
            ParsedDocument.isPhrase(traverser.parent(), [PhraseType.SimpleVariable]);
    }

    completions(context: Context) {

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

        let limit = Math.min(varSymbols.length, this.config.maxItems);
        let isIncomplete = varSymbols.length > this.config.maxItems;

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
        'case',
        'catch',
        'class',
        'const',
        'continue',
        'declare',
        'default',
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
        'as',
        'self'
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

    completions(context: Context) {

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

        return super.completions(context);

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

    constructor(public config: CompletionProviderConfig) { }

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
        let isIncomplete = symbols.length > this.config.maxItems;
        let limit = Math.min(symbols.length, this.config.maxItems);
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

    constructor(public config: CompletionProviderConfig) { }

    canSuggest(context: Context) {
        let traverser = context.createTraverser();

        if (ParsedDocument.isToken(traverser.node, [TokenType.Arrow])) {
            return ParsedDocument.isPhrase(traverser.parent(),
                [PhraseType.PropertyAccessExpression, PhraseType.MethodCallExpression]);
        }

        return ParsedDocument.isPhrase(traverser.parent(), [PhraseType.MemberName]);

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
        let isIncomplete = symbols.length > this.config.maxItems;
        let limit = Math.min(symbols.length, this.config.maxItems);
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

    private _isInterfaceClause(node: Phrase | Token) {
        return (<Phrase>node).phraseType === PhraseType.ClassInterfaceClause ||
            (<Phrase>node).phraseType === PhraseType.InterfaceBaseClause;
    }

}

class NamespaceDefinitionCompletion implements CompletionStrategy {

    constructor(public config: CompletionProviderConfig) { }

    canSuggest(context: Context) {
        return context.createTraverser().ancestor(this._isNamespaceDefinition) !== null;
    }

    completions(context: Context) {
        let items: lsp.CompletionItem[] = [];
        let text = context.word;

        let matches = uniqueSymbolNames(context.symbolStore.match(text, this._symbolFilter, true));
        let limit = Math.min(matches.length, this.config.maxItems - items.length);
        let isIncomplete = matches.length > this.config.maxItems - items.length;

        for (let n = 0; n < limit; ++n) {
            items.push(this._toNamespaceCompletionItem(matches[n]));
        }

        return <lsp.CompletionList>{
            items: items,
            isIncomplete: isIncomplete
        }

    }

    private _toNamespaceCompletionItem(s: PhpSymbol) {
        return <lsp.CompletionItem>{
            label: s.name,
            kind: lsp.CompletionItemKind.Module
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

    constructor(public config: CompletionProviderConfig) { }

    canSuggest(context: Context) {
        return context.createTraverser().ancestor(this._isNamespaceUseClause) !== null;
    }

    completions(context: Context) {

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

        let matches = uniqueSymbolNames(context.symbolStore.match(text, pred, true).slice(0, this.config.maxItems));
        for (let n = 0, l = matches.length; n < l; ++n) {
            items.push(this._toCompletionItem(matches[n]));
        }

        return <lsp.CompletionList>{
            isIncomplete: matches.length === this.config.maxItems,
            items: items
        }

    }

    private _toCompletionItem(s: PhpSymbol) {
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

    constructor(public config: CompletionProviderConfig) { }

    canSuggest(context: Context) {
        return context.createTraverser().ancestor(this._isNamespaceUseGroupClause) !== null;
    }

    completions(context: Context) {

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

        let matches = context.symbolStore.match(text, pred, true).slice(0, this.config.maxItems);
        for (let n = 0, l = matches.length; n < l; ++n) {
            items.push(this._toCompletionItem(matches[n], matches[n].name.slice(prefix.length + 1))); //+1 for \
        }

        return <lsp.CompletionList>{
            isIncomplete: matches.length === this.config.maxItems,
            items: items
        }

    }

    private _toCompletionItem(s: PhpSymbol, insertText: string) {
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

    constructor(public config: CompletionProviderConfig) { }

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

    completions(context: Context) {
        let text = context.word;
        return <lsp.CompletionList>{
            items: keywordCompletionItems(DeclarationBodyCompletion._keywords, text)
        }
    }

}

class MethodDeclarationHeaderCompletion implements CompletionStrategy {

    constructor(public config: CompletionProviderConfig) { }

    canSuggest(context: Context) {
        let traverser = context.createTraverser();
        let thisSymbol = context.classSymbol;
        return ParsedDocument.isPhrase(traverser.parent(), [PhraseType.Identifier]) &&
            ParsedDocument.isPhrase(traverser.parent(), [PhraseType.MethodDeclarationHeader]) &&
            !!thisSymbol && !!thisSymbol.associated && thisSymbol.associated.length > 0;
    }

    completions(context: Context) {

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

        let matches = context.symbolStore.lookupMembersOnTypes(queries).slice(0, this.config.maxItems);
        let items: lsp.CompletionItem[] = [];
        for (let n = 0, l = matches.length; n < l; ++n) {
            items.push(this._toCompletionItem(matches[n]));
        }

        return <lsp.CompletionList>{
            isIncomplete: matches.length === this.config.maxItems,
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
