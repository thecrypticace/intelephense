/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */

'use strict';

import { Token, TokenType, Phrase, PhraseType } from 'php7parser';
import {
    PhpSymbol, SymbolKind, SymbolModifier
} from './symbol';
import { SymbolStore, SymbolTable } from './symbolStore';
import { SymbolReader } from './symbolReader';
import { TypeString } from './typeString';
import { NameResolver } from './nameResolver';
import { ParsedDocument, ParsedDocumentStore } from './parsedDocument';
import { Predicate } from './types';
import { ParseTreeTraverser } from './context';
import * as lsp from 'vscode-languageserver-types';
import * as util from './util';
import { TypeAggregate, MemberMergeStrategy } from './typeAggregate';

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
        case SymbolKind.ClassConstant:
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
        detail: PhpSymbol.signatureString(s)
    };

    if (s.doc && s.doc.description) {
        item.documentation = s.doc.description;
    }

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
    };

    if (s.doc && s.doc.description) {
        item.documentation = s.doc.description;
    }

    if (s.value) {
        item.detail = '= ' + s.value;
    }

    return item;
}


function toPropertyCompletionItem(s: PhpSymbol) {
    let item = <lsp.CompletionItem>{
        kind: lsp.CompletionItemKind.Property,
        label: !(s.modifiers & SymbolModifier.Static) ? s.name.slice(1) : s.name,
        detail: PhpSymbol.type(s)
    }

    if (s.doc && s.doc.description) {
        item.documentation = s.doc.description;
    }

    return item;
}

function toVariableCompletionItem(s: PhpSymbol, varTable: VariableTable) {

    let item = <lsp.CompletionItem>{
        label: s.name,
        kind: lsp.CompletionItemKind.Variable,
        detail: varTable.getType(s.name).toString()
    }

    if (s.doc && s.doc.description) {
        item.documentation = s.doc.description;
    }

    return item;

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

export interface CompletionOptions {
    maxItems: number
}

export class CompletionProvider {

    private _maxItems: number;
    private _strategies: CompletionStrategy[];
    private _config: CompletionOptions;
    private static _defaultConfig: CompletionOptions = { maxItems: 100 };

    constructor(
        public symbolStore: SymbolStore,
        public documentStore: ParsedDocumentStore,
        config?: CompletionOptions) {

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

    set config(config: CompletionOptions) {
        this._config = config;
        for (let n = 0, l = this._strategies.length; n < l; ++n) {
            this._strategies[n].config = config;
        }
    }

    provideCompletions(uri: string, position: lsp.Position) {

        let doc = this.documentStore.find(uri);
        let table = this.symbolStore.getSymbolTable(uri);

        if (!doc || !table) {
            return noCompletionResponse;
        }

        let traverser = new ParseTreeTraverser(doc, table);
        traverser.position(position);
        let word = doc.wordAtOffset(doc.offsetAtPosition(position));
        let strategy: CompletionStrategy = null;

        for (let n = 0, l = this._strategies.length; n < l; ++n) {
            if (this._strategies[n].canSuggest(traverser.clone())) {
                strategy = this._strategies[n];
                break;
            }
        }

        return strategy ? strategy.completions(traverser, word) : noCompletionResponse;

    }

}

interface CompletionStrategy {
    config: CompletionOptions;
    canSuggest(traverser: ParseTreeTraverser): boolean;
    completions(traverser: ParseTreeTraverser, word: string): lsp.CompletionList;
}

abstract class AbstractNameCompletion implements CompletionStrategy {

    constructor(public config: CompletionOptions, public symbolStore: SymbolStore) { }

    abstract canSuggest(traverser: ParseTreeTraverser): boolean;

    completions(traverser: ParseTreeTraverser, word: string) {

        let items: lsp.CompletionItem[] = [];
        let namePhrase = traverser.clone().ancestor(this._isNamePhrase) as Phrase;
        let nameResolver = traverser.nameResolver;

        if (!word || !namePhrase) {
            return noCompletionResponse;
        }

        let pred = this._symbolFilter;
        if (namePhrase && namePhrase.phraseType === PhraseType.RelativeQualifiedName) {
            //symbols share current namespace
            word = word.slice(10); //namespace\
            let ns = nameResolver.namespaceName;
            let sf = this._symbolFilter;
            pred = (x) => {
                return sf(x) && x.name.indexOf(ns) === 0;
            };
        }

        let matches = this.symbolStore.match(word, pred);
        if (namePhrase && namePhrase.phraseType === PhraseType.QualifiedName) {
            //keywords and imports
            Array.prototype.push.apply(items, keywordCompletionItems(this._getKeywords(traverser.clone()), word));
            let imports = this._importedSymbols(nameResolver.rules, pred, word);
            matches = this._mergeSymbols(matches, imports);
        }

        let limit = Math.min(matches.length, this.config.maxItems - items.length);
        let isIncomplete = matches.length > this.config.maxItems - items.length;

        for (let n = 0; n < limit; ++n) {
            items.push(this._toCompletionItem(matches[n], nameResolver.namespaceName, namePhrase.phraseType));
        }

        return <lsp.CompletionList>{
            items: items,
            isIncomplete: isIncomplete
        }

    }

    protected abstract _getKeywords(traverser: ParseTreeTraverser): string[];

    protected _importedSymbols(rules: PhpSymbol[], pred: Predicate<PhpSymbol>, text: string) {

        let filteredRules: PhpSymbol[] = [];
        let r: PhpSymbol;
        for (let n = 0, l = rules.length; n < l; ++n) {
            r = rules[n];
            if (r.associated && r.associated.length > 0 && util.fuzzyStringMatch(text, r.name)) {
                filteredRules.push(r);
            }
        }

        //lookup associated symbol
        let s: PhpSymbol;
        let merged: PhpSymbol;
        let imported: PhpSymbol[] = [];
        for (let n = 0, l = filteredRules.length; n < l; ++n) {
            r = filteredRules[n];
            s = this.symbolStore.find(r.associated[0].name, pred).shift();
            if (s) {
                merged = PhpSymbol.clone(s);
                merged.associated = r.associated;
                merged.modifiers |= SymbolModifier.Use;
                merged.name = r.name;
                imported.push(merged);
            }
        }
        return imported;
    }

    protected _toCompletionItem(s: PhpSymbol, namespaceName: string, namePhraseType: PhraseType): lsp.CompletionItem {

        let item = <lsp.CompletionItem>{
            kind: lsp.CompletionItemKind.Class,
            label: PhpSymbol.notFqn(s.name),
            insertText: createInsertText(s, namespaceName, namePhraseType)
        }

        if (s.doc && s.doc.description) {
            item.documentation = s.doc.description;
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
                if (s.value) {
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

    protected _getNamePhrase(traverser: ParseTreeTraverser) {
        return traverser.ancestor(this._isNamePhrase) as Phrase;
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

    canSuggest(traverser: ParseTreeTraverser) {

        return ParsedDocument.isPhrase(traverser.parent(), [PhraseType.NamespaceName]) &&
            ParsedDocument.isPhrase(traverser.parent(),
                [PhraseType.FullyQualifiedName, PhraseType.QualifiedName, PhraseType.RelativeQualifiedName]) &&
            ParsedDocument.isPhrase(traverser.parent(), [PhraseType.ClassTypeDesignator]);

    }

    protected _symbolFilter(s: PhpSymbol) {
        return s.kind === SymbolKind.Class &&
            !(s.modifiers & (SymbolModifier.Anonymous | SymbolModifier.Abstract));
    }

    protected _getKeywords(traverser: ParseTreeTraverser) {

        if (traverser.ancestor(this._isQualifiedName)) {
            return ClassTypeDesignatorCompletion._keywords;
        }
        return [];
    }

    protected _toCompletionItem(s: PhpSymbol, namespaceName: string, namePhraseType: PhraseType) {

        let item = <lsp.CompletionItem>{
            kind: lsp.CompletionItemKind.Constructor,
            label: PhpSymbol.notFqn(s.name),
            insertText: createInsertText(s, namespaceName, namePhraseType)
        }

        if (s.doc && s.doc.description) {
            item.documentation = s.doc.description;
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

    constructor(public config: CompletionOptions, public symbolStore: SymbolStore) { }

    canSuggest(traverser: ParseTreeTraverser) {
        return ParsedDocument.isToken(traverser.node, [TokenType.Dollar, TokenType.VariableName]) &&
            ParsedDocument.isPhrase(traverser.parent(), [PhraseType.SimpleVariable]);
    }

    completions(traverser: ParseTreeTraverser, word: string) {

        if (!word) {
            return noCompletionResponse;
        }

        let scope = traverser.scope;
        let symbolMask = SymbolKind.Variable | SymbolKind.Parameter;
        let varSymbols = scope.children ? scope.children.filter((x) => {
            return (x.kind & symbolMask) > 0 && x.name.indexOf(word) === 0;
        }) : [];
        //also suggest built in globals vars
        Array.prototype.push.apply(varSymbols, this.symbolStore.match(word, this._isBuiltInGlobalVar));

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

    canSuggest(traverser: ParseTreeTraverser) {

        return ParsedDocument.isPhrase(traverser.parent(), [PhraseType.NamespaceName]) &&
            traverser.ancestor(this._isNamePhrase) !== null;
    }

    completions(traverser: ParseTreeTraverser, word: string) {

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

        return super.completions(traverser, word);

    }

    protected _getKeywords(traverser: ParseTreeTraverser) {
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

abstract class MemberAccessCompletion implements CompletionStrategy {

    constructor(public config: CompletionOptions, public symbolStore: SymbolStore) { }

    abstract canSuggest(traverser: ParseTreeTraverser);

    completions(traverser: ParseTreeTraverser, word: string) {

        let scopedAccessExpr = traverser.ancestor(this._isMemberAccessExpr);
        let scopePhrase = traverser.nthChild(0) as Phrase;
        let type = this._resolveType(traverser);
        let typeNames = TypeString.atomicClassArray(type);

        if (!typeNames.length) {
            return noCompletionResponse;
        }

        let nameResolver = traverser.nameResolver;
        let classSymbol = nameResolver.class;
        let classAggregateType: TypeAggregate;
        if (classSymbol) {
            classAggregateType = new TypeAggregate(this.symbolStore, classSymbol);
        }
        let typeName: string;
        let fn: Predicate<PhpSymbol>;
        let typeAggregate: TypeAggregate;
        let symbols: PhpSymbol[] = [];

        for (let n = 0, l = typeNames.length; n < l; ++n) {
            typeName = typeNames[n];
            if (classSymbol && classSymbol.name.toLowerCase() === typeName.toLowerCase()) {
                typeAggregate = classAggregateType;
            } else {
                typeAggregate = TypeAggregate.create(this.symbolStore, typeName);
            }

            if (!typeAggregate) {
                continue;
            }

            fn = this._createMemberPredicate(typeName, word, classAggregateType);
            Array.prototype.push.apply(symbols, typeAggregate.members(MemberMergeStrategy.Documented, fn));
        }

        symbols = Array.from(new Set<PhpSymbol>(symbols)); //unique
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

    private _resolveType(traverser: ParseTreeTraverser): string {

    }

    protected abstract _createMemberPredicate(scopeName: string, word: string, classContext: TypeAggregate): Predicate<PhpSymbol>;

    protected _isMemberAccessExpr(node: Phrase | Token) {
        switch ((<Phrase>node).phraseType) {
            case PhraseType.ScopedCallExpression:
            case PhraseType.ErrorScopedAccessExpression:
            case PhraseType.ClassConstantAccessExpression:
            case PhraseType.ScopedPropertyAccessExpression:
            case PhraseType.PropertyAccessExpression:
            case PhraseType.MethodCallExpression:
                return true;
            default:
                return false;
        }
    }

    protected _toCompletionItem(s: PhpSymbol) {
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

}

class ScopedAccessCompletion extends MemberAccessCompletion {


    canSuggest(traverser: ParseTreeTraverser) {
        const scopedAccessPhrases = [
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

    protected _createMemberPredicate(scopeName: string, word: string, classContext: TypeAggregate): Predicate<PhpSymbol> {
        if (scopeName === classContext!.name.toLowerCase()) {
            //public, protected, private
            return (x) => {
                return (x.modifiers & SymbolModifier.Static) > 0 && util.fuzzyStringMatch(word, x.name);
            };
        } else if (classContext!.isBaseClass(scopeName)) {
            //public, protected
            //looking for non static here as well to handle parent keyword
            return (x) => {
                return !(x.modifiers & SymbolModifier.Private) && util.fuzzyStringMatch(word, x.name);
            };

        } else if (classContext!.isAssociated(scopeName)) {
            //public, protected
            return (x) => {
                return (x.modifiers & SymbolModifier.Static) > 0 &&
                    !(x.modifiers & SymbolModifier.Private) &&
                    util.fuzzyStringMatch(word, x.name);
            };

        } else {
            //public
            const mask = SymbolModifier.Static | SymbolModifier.Public;
            return (x) => {
                return (x.modifiers & mask) === mask && util.fuzzyStringMatch(word, x.name);
            };
        }
    }

}

class ObjectAccessCompletion extends MemberAccessCompletion {

    canSuggest(traverser: ParseTreeTraverser) {

        if (ParsedDocument.isToken(traverser.node, [TokenType.Arrow])) {
            return ParsedDocument.isPhrase(traverser.parent(),
                [PhraseType.PropertyAccessExpression, PhraseType.MethodCallExpression]);
        }

        return ParsedDocument.isPhrase(traverser.parent(), [PhraseType.MemberName]);

    }

    protected _createMemberPredicate(scopeName: string, word: string, classContext: TypeAggregate): Predicate<PhpSymbol> {
        if (scopeName === classContext!.name.toLowerCase()) {
            //public, protected, private
            return (x) => {
                return !(x.modifiers & SymbolModifier.Static) && util.fuzzyStringMatch(word, x.name);
            };
        } else if (classContext!.isAssociated(scopeName)) {
            //public, protected
            const mask = SymbolModifier.Static | SymbolModifier.Private;
            return (x) => {
                return !(x.modifiers & mask) && util.fuzzyStringMatch(word, x.name);
            };

        } else {
            //public
            const mask = SymbolModifier.Static | SymbolModifier.Protected | SymbolModifier.Private;
            return (x) => {
                return !(x.modifiers & mask) && util.fuzzyStringMatch(word, x.name);
            };
        }
    }

}

class TypeDeclarationCompletion extends AbstractNameCompletion {

    private static _keywords = [
        'self', 'array', 'callable', 'bool', 'float', 'int', 'string'
    ];

    canSuggest(traverser: ParseTreeTraverser) {
        return ParsedDocument.isToken(traverser.node, [TokenType.Name, TokenType.Backslash, TokenType.Array, TokenType.Callable]) &&
            traverser.ancestor(this._isTypeDeclaration) !== undefined;
    }

    protected _getKeywords(traverser: ParseTreeTraverser) {
        return TypeDeclarationCompletion._keywords;
    }

    protected _symbolFilter(s: PhpSymbol) {
        return (s.kind & (SymbolKind.Class | SymbolKind.Interface)) > 0;
    }

    private _isTypeDeclaration(node: Phrase | Token) {
        return (<Phrase>node).phraseType === PhraseType.TypeDeclaration;
    }

}

class ClassBaseClauseCompletion extends AbstractNameCompletion {

    canSuggest(traverser: ParseTreeTraverser) {
        return traverser.ancestor(this._isClassBaseClause) !== undefined;
    }

    protected _getKeywords(traverser: ParseTreeTraverser) {
        return [];
    }

    protected _symbolFilter(s: PhpSymbol) {
        return s.kind === SymbolKind.Class && !(s.modifiers & SymbolModifier.Final);
    }

    private _isClassBaseClause(node: Phrase | Token) {
        return (<Phrase>node).phraseType === PhraseType.ClassBaseClause;
    }

}

class InterfaceClauseCompletion extends AbstractNameCompletion {

    canSuggest(traverser: ParseTreeTraverser) {
        return traverser.ancestor(this._isInterfaceClause) !== undefined;

    }

    protected _getKeywords(traverser: ParseTreeTraverser) {
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

    constructor(public config: CompletionOptions, public symbolStore: SymbolStore) { }

    canSuggest(traverser: ParseTreeTraverser) {
        return traverser.ancestor(this._isNamespaceDefinition) !== undefined;
    }

    completions(traverser: ParseTreeTraverser, word: string) {

        let items: lsp.CompletionItem[] = [];
        let matches = PhpSymbol.unique(this.symbolStore.match(word, this._symbolFilter));
        let limit = Math.min(matches.length, this.config.maxItems);
        let isIncomplete = matches.length > this.config.maxItems;

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

    constructor(public config: CompletionOptions, public symbolStore:SymbolStore) { }

    canSuggest(traverser: ParseTreeTraverser) {
        return traverser.ancestor(this._isNamespaceUseClause) !== undefined;
    }

    completions(traverser: ParseTreeTraverser, word: string) {

        let items: lsp.CompletionItem[] = [];
        let namespaceUseDecl = traverser.ancestor(this._isNamespaceUseDeclaration) as Phrase;

        if (!word) {
            return noCompletionResponse;
        }

        let kind = this._modifierToSymbolKind(<Token>traverser.child(this._isModifier));

        let pred = (x: PhpSymbol) => {
            return (x.kind & kind) > 0 && !(x.modifiers & SymbolModifier.Use);
        }

        let matches = PhpSymbol.unique(this.symbolStore.match(word, pred));
        let isIncomplete = matches.length > this.config.maxItems;
        let limit = Math.min(this.config.maxItems, matches.length);
        for (let n = 0; n < limit; ++n) {
            items.push(this._toCompletionItem(matches[n]));
        }

        return <lsp.CompletionList>{
            isIncomplete: isIncomplete,
            items: items
        }

    }

    private _toCompletionItem(s: PhpSymbol) {
        let item = lsp.CompletionItem.create(s.name);
        item.kind = symbolKindToLspSymbolKind(s.kind);
        if(s.kind !== SymbolKind.Namespace) {
            item.sortText = item.filterText = s.name;
        }

        if (s.doc && s.doc.description) {
            item.documentation = s.doc.description;
        }

        return item;
    }

    private _isNamespaceUseDeclaration(node: Phrase | Token) {
        return (<Phrase>node).phraseType === PhraseType.NamespaceUseDeclaration;
    }

    private _isNamespaceUseClause(node: Phrase | Token) {
        return (<Phrase>node).phraseType === PhraseType.NamespaceUseClause;
    }

    private _modifierToSymbolKind(token: Token) {
        if (!token) {
            return SymbolKind.Class | SymbolKind.Namespace;
        }

        switch (token.tokenType) {
            case TokenType.Function:
                return SymbolKind.Function;
            case TokenType.Const:
                return SymbolKind.Constant;
            default:
                return SymbolKind.Class | SymbolKind.Namespace;
        }
    }

    private _isModifier(node: Phrase | Token) {
        switch ((<Token>node).tokenType) {
            case TokenType.Class:
            case TokenType.Function:
            case TokenType.Const:
                return true;
            default:
                return false;
        }
    }

}

class NamespaceUseGroupClauseCompletion implements CompletionStrategy {

    constructor(public config: CompletionOptions, public symbolStore:SymbolStore) { }

    canSuggest(traverser:ParseTreeTraverser) {
        return traverser.ancestor(this._isNamespaceUseGroupClause) !== undefined;
    }

    completions(traverser:ParseTreeTraverser, word:string) {

        let items: lsp.CompletionItem[] = [];
        if (!word) {
            return noCompletionResponse;
        }

        let nsUseGroupClause = traverser.ancestor(this._isNamespaceUseGroupClause) as Phrase;
        let nsUseGroupClauseModifier = traverser.child(this._isModifier) as Token;
        let nsUseDecl = traverser.ancestor(this._isNamespaceUseDeclaration) as Phrase;
        let nsUseDeclModifier = traverser.child(this._isModifier) as Token;
        let kind = this._modifierToSymbolKind(nsUseGroupClauseModifier || nsUseDeclModifier);
        let prefix = '';
        traverser.parent();
        if(traverser.child(this._isNamespaceName)) {
            prefix = traverser.text.toLowerCase();
        }

        let pred = (x:PhpSymbol) => {
            return (x.kind & kind) > 0 && !(x.modifiers & SymbolModifier.Use) && (!prefix || x.name.toLowerCase().indexOf(prefix) === 0);
        };

        let matches = this.symbolStore.match(word, pred);
        let isIncomplete = matches.length > this.config.maxItems;
        let limit = Math.min(this.config.maxItems, matches.length);
        for (let n = 0; n < limit; ++n) {
            items.push(this._toCompletionItem(matches[n], matches[n].name.slice(prefix.length + 1))); //+1 for \
        }

        return <lsp.CompletionList>{
            isIncomplete: isIncomplete,
            items: items
        }

    }

    private _toCompletionItem(s: PhpSymbol, insertText: string) {
        let item = lsp.CompletionItem.create(PhpSymbol.notFqn(s.name));
        item.insertText = insertText;
        item.kind = symbolKindToLspSymbolKind(s.kind);
        item.detail = s.name;

        if (s.doc && s.doc.description) {
            item.documentation = s.doc.description;
        }

        return item;
    }

    private _isNamespaceUseGroupClause(node: Phrase | Token) {
        return (<Phrase>node).phraseType === PhraseType.NamespaceUseGroupClause;
    }

    private _isNamespaceUseDeclaration(node: Phrase | Token) {
        return (<Phrase>node).phraseType === PhraseType.NamespaceUseDeclaration;
    }

    private _isModifier(node: Phrase | Token) {
        switch ((<Token>node).tokenType) {
            case TokenType.Class:
            case TokenType.Function:
            case TokenType.Const:
                return true;
            default:
                return false;
        }
    }

    private _isNamespaceName(node:Phrase|Token) {
        return (<Phrase>node).phraseType === PhraseType.NamespaceName;
    }

    private _modifierToSymbolKind(modifier:Token) {
        if (!modifier) {
            return SymbolKind.Class;
        }

        switch (modifier.tokenType) {
            case TokenType.Function:
                return SymbolKind.Function;
            case TokenType.Const:
                return SymbolKind.Constant;
            default:
                return SymbolKind.Class;
        }
    }

}

class DeclarationBodyCompletion implements CompletionStrategy {

    constructor(public config: CompletionOptions) { }

    private static _phraseTypes = [
        PhraseType.ClassDeclarationBody, PhraseType.InterfaceDeclarationBody, PhraseType.TraitDeclarationBody,
        PhraseType.ErrorClassMemberDeclaration
    ];

    private static _keywords = [
        'var', 'public', 'private', 'protected', 'final', 'function', 'abstract', 'implements', 'extends'
    ];

    canSuggest(traverser: ParseTreeTraverser) {
        return ParsedDocument.isPhrase(traverser.parent(), DeclarationBodyCompletion._phraseTypes);
    }

    completions(traverser: ParseTreeTraverser, word:string) {
        return <lsp.CompletionList>{
            items: keywordCompletionItems(DeclarationBodyCompletion._keywords, word)
        }
    }

}

class MethodDeclarationHeaderCompletion implements CompletionStrategy {

    constructor(public config: CompletionOptions) { }

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
        }) as Phrase;

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
            detail: s.scope
        };

        if (s.doc && s.doc.description) {
            item.documentation = s.doc.description;
        }

        return item;

    }

    private _parameterToString(s: PhpSymbol) {

        let parts: String[] = [];

        if (s.type) {
            let typeName = TypeString.atomicClassArray(s.type).shift();
            if (typeName) {
                typeName = '\\' + typeName;
            } else {
                typeName = s.type;
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
