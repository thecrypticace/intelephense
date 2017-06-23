/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const symbol_1 = require("./symbol");
const symbolReader_1 = require("./symbolReader");
const parsedDocument_1 = require("./parsedDocument");
const context_1 = require("./context");
const lsp = require("vscode-languageserver-types");
const util = require("./util");
const noCompletionResponse = {
    items: [],
    isIncomplete: false
};
function keywordCompletionItems(keywords, text) {
    let kw;
    let items = [];
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
function createSignatureHelpCommand(uri, position) {
    return {
        command: 'vscode.executeSignatureHelpProvider',
        title: 'Signature Help',
        arguments: [uri, position]
    };
}
function createInsertText(s, nsName, namePhraseType) {
    let insertText = s.name;
    if (nsName && s.name.indexOf(nsName) === 0 && insertText.length > nsName.length + 1) {
        insertText = insertText.slice(nsName.length + 1);
        if (namePhraseType === 143 /* RelativeQualifiedName */) {
            insertText = 'namespace\\' + insertText;
        }
    }
    else if (nsName && namePhraseType !== 83 /* FullyQualifiedName */ && !(s.modifiers & 4096 /* Use */)) {
        insertText = '\\' + insertText;
    }
    return insertText;
}
function symbolKindToLspSymbolKind(kind) {
    switch (kind) {
        case 1 /* Class */:
            return lsp.CompletionItemKind.Class;
        case 64 /* Function */:
            return lsp.CompletionItemKind.Function;
        case 8 /* Constant */:
            return lsp.CompletionItemKind.Value;
        case 2 /* Interface */:
            return lsp.CompletionItemKind.Interface;
        case 512 /* Namespace */:
            return lsp.CompletionItemKind.Module;
        default:
            return lsp.SymbolKind.String;
    }
}
function toMethodCompletionItem(s) {
    let item = {
        kind: lsp.CompletionItemKind.Method,
        label: s.name,
        documentation: s.description,
        detail: symbol_1.PhpSymbol.signatureString(s)
    };
    if (s.name.slice(0, 2) === '__') {
        //sort magic methods last
        item.sortText = 'zzz';
    }
    return item;
}
function toClassConstantCompletionItem(s) {
    let item = {
        kind: lsp.CompletionItemKind.Value,
        label: s.name,
        documentation: s.description,
    };
    if (s.value) {
        item.detail = '= ' + s.value;
    }
    return item;
}
function toPropertyCompletionItem(s) {
    return {
        kind: lsp.CompletionItemKind.Property,
        label: !(s.modifiers & 32 /* Static */) ? s.name.slice(1) : s.name,
        documentation: s.description,
        detail: s.type ? s.type.toString() : ''
    };
}
function toVariableCompletionItem(s, varTable) {
    return {
        label: s.name,
        kind: lsp.CompletionItemKind.Variable,
        documentation: s.description,
        detail: varTable.getType(s.name).toString()
    };
}
function uniqueSymbolNames(symbols) {
    let set = new Set();
    let s;
    let unique = [];
    for (let n = 0, l = symbols.length; n < l; ++n) {
        s = symbols[n];
        if (!set.has(s.name)) {
            unique.push(s);
            set.add(s.name);
        }
    }
    return unique;
}
function tokenToSymbolKind(t) {
    if (!t) {
        return 0;
    }
    switch (t.tokenType) {
        case 9 /* Class */:
            return 1 /* Class */;
        case 35 /* Function */:
            return 64 /* Function */;
        case 12 /* Const */:
            return 8 /* Constant */;
        default:
            return 0;
    }
}
class CompletionProvider {
    constructor(symbolStore, documentStore, config) {
        this.symbolStore = symbolStore;
        this.documentStore = documentStore;
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
    set config(config) {
        this._config = config;
        for (let n = 0, l = this._strategies.length; n < l; ++n) {
            this._strategies[n].config = config;
        }
    }
    provideCompletions(uri, position) {
        let doc = this.documentStore.find(uri);
        if (!doc) {
            return noCompletionResponse;
        }
        let context = new context_1.Context(this.symbolStore, doc, position);
        let strategy = null;
        for (let n = 0, l = this._strategies.length; n < l; ++n) {
            if (this._strategies[n].canSuggest(context)) {
                strategy = this._strategies[n];
                break;
            }
        }
        return strategy ? strategy.completions(context) : noCompletionResponse;
    }
}
CompletionProvider._defaultConfig = { maxItems: 100 };
exports.CompletionProvider = CompletionProvider;
class AbstractNameCompletion {
    constructor(config) {
        this.config = config;
    }
    completions(context) {
        let items = [];
        let namePhrase = this._getNamePhrase(context);
        let text = context.word;
        if (!text) {
            return noCompletionResponse;
        }
        let pred = this._symbolFilter;
        if (namePhrase && namePhrase.phraseType === 143 /* RelativeQualifiedName */) {
            //symbols share current namespace
            text = text.slice(10); //namespace\
            let ns = context.namespace;
            let sf = this._symbolFilter;
            pred = (x) => {
                return sf(x) && x.name.indexOf(ns) === 0;
            };
        }
        let matches = context.symbolStore.match(text, pred, true);
        if (namePhrase && namePhrase.phraseType === 140 /* QualifiedName */) {
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
        return {
            items: items,
            isIncomplete: isIncomplete
        };
    }
    _importedSymbols(context, pred, text) {
        let filteredRules = [];
        let r;
        let rules = context.nameResolver.rules;
        for (let n = 0, l = rules.length; n < l; ++n) {
            r = rules[n];
            if (r.associated && r.associated.length > 0 && util.fuzzyStringMatch(text, r.name)) {
                filteredRules.push(r);
            }
        }
        //lookup associated symbol
        let s;
        let merged;
        let imported = [];
        for (let n = 0, l = filteredRules.length; n < l; ++n) {
            r = filteredRules[n];
            s = context.symbolStore.find(r.associated[0].name, pred);
            if (s) {
                merged = symbol_1.PhpSymbol.clone(s);
                merged.associated = r.associated;
                merged.modifiers |= 4096 /* Use */;
                merged.name = r.name;
                imported.push(merged);
            }
        }
        return imported;
    }
    _toCompletionItem(s, context, namePhraseType) {
        let item = {
            kind: lsp.CompletionItemKind.Class,
            label: symbol_1.PhpSymbol.notFqn(s.name),
            documentation: s.description,
            insertText: createInsertText(s, context.namespace, namePhraseType)
        };
        switch (s.kind) {
            case 2 /* Interface */:
                item.kind = lsp.CompletionItemKind.Interface;
            //fall though
            case 1 /* Class */:
                if ((s.modifiers & 4096 /* Use */) > 0 && s.associated && s.associated.length) {
                    item.detail = s.associated[0].name;
                }
                else {
                    item.detail = s.name;
                }
                break;
            case 8 /* Constant */:
                item.kind = lsp.CompletionItemKind.Value;
                if (s.value) {
                    item.detail = s.value;
                }
                break;
            case 64 /* Function */:
                item.kind = lsp.CompletionItemKind.Function;
                item.detail = symbol_1.PhpSymbol.signatureString(s);
                break;
            case 512 /* Namespace */:
                return {
                    label: s.name,
                    kind: lsp.CompletionItemKind.Module
                };
            default:
                throw new Error('Invalid Argument');
        }
        return item;
    }
    _getNamePhrase(context) {
        return context.createTraverser().ancestor(this._isNamePhrase);
    }
    _isNamePhrase(node) {
        switch (node.phraseType) {
            case 140 /* QualifiedName */:
            case 83 /* FullyQualifiedName */:
            case 143 /* RelativeQualifiedName */:
                return true;
            default:
                return false;
        }
    }
    _mergeSymbols(matches, imports) {
        let merged = imports.slice(0);
        let map = {};
        let imported;
        let s;
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
    canSuggest(context) {
        let traverser = context.createTraverser();
        return parsedDocument_1.ParsedDocument.isPhrase(traverser.parent(), [120 /* NamespaceName */]) &&
            parsedDocument_1.ParsedDocument.isPhrase(traverser.parent(), [83 /* FullyQualifiedName */, 140 /* QualifiedName */, 143 /* RelativeQualifiedName */]) &&
            parsedDocument_1.ParsedDocument.isPhrase(traverser.parent(), [34 /* ClassTypeDesignator */]);
    }
    _symbolFilter(s) {
        return s.kind === 1 /* Class */ &&
            !(s.modifiers & (512 /* Anonymous */ | 16 /* Abstract */));
    }
    _getKeywords(context) {
        if (context.createTraverser().ancestor(this._isQualifiedName)) {
            return ClassTypeDesignatorCompletion._keywords;
        }
        return [];
    }
    _toCompletionItem(s, context, namePhraseType) {
        let item = {
            kind: lsp.CompletionItemKind.Constructor,
            label: symbol_1.PhpSymbol.notFqn(s.name),
            documentation: s.description,
            insertText: createInsertText(s, context.namespace, namePhraseType)
        };
        if ((s.modifiers & 4096 /* Use */) > 0 && s.associated && s.associated.length) {
            item.detail = s.associated[0].name;
        }
        else {
            item.detail = s.name;
        }
        return item;
    }
    _isQualifiedName(node) {
        return node.phraseType === 140 /* QualifiedName */;
    }
}
ClassTypeDesignatorCompletion._keywords = [
    'class', 'static', 'namespace'
];
class SimpleVariableCompletion {
    constructor(config) {
        this.config = config;
    }
    canSuggest(context) {
        let traverser = context.createTraverser();
        return parsedDocument_1.ParsedDocument.isToken(traverser.node, [90 /* Dollar */, 84 /* VariableName */]) &&
            parsedDocument_1.ParsedDocument.isPhrase(traverser.parent(), [155 /* SimpleVariable */]);
    }
    completions(context) {
        let text = context.word;
        if (!text) {
            return noCompletionResponse;
        }
        let scope = context.scopeSymbol;
        let symbolMask = 256 /* Variable */ | 128 /* Parameter */;
        let varSymbols = scope.children ? scope.children.filter((x) => {
            return (x.kind & symbolMask) > 0 && x.name.indexOf(text) === 0;
        }) : [];
        //also suggest built in globals vars
        Array.prototype.push.apply(varSymbols, context.symbolStore.match(text, this._isBuiltInGlobalVar));
        let limit = Math.min(varSymbols.length, this.config.maxItems);
        let isIncomplete = varSymbols.length > this.config.maxItems;
        let items = [];
        let varTable = context.variableTable;
        for (let n = 0; n < limit; ++n) {
            items.push(toVariableCompletionItem(varSymbols[n], varTable));
        }
        return {
            items: items,
            isIncomplete: isIncomplete
        };
    }
    _isBuiltInGlobalVar(s) {
        return s.kind === 256 /* Variable */ && !s.location;
    }
}
class NameCompletion extends AbstractNameCompletion {
    canSuggest(context) {
        let traverser = context.createTraverser();
        return parsedDocument_1.ParsedDocument.isPhrase(traverser.parent(), [120 /* NamespaceName */]) &&
            traverser.ancestor(this._isNamePhrase) !== null;
    }
    completions(context) {
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
    _getKeywords(context) {
        let kw = [];
        Array.prototype.push.apply(kw, NameCompletion._expressionKeywords);
        Array.prototype.push.apply(kw, NameCompletion._statementKeywords);
        return kw;
    }
    _symbolFilter(s) {
        return (s.kind & (1 /* Class */ | 64 /* Function */ | 8 /* Constant */)) > 0 &&
            !(s.modifiers & 512 /* Anonymous */);
    }
}
NameCompletion._statementKeywords = [
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
NameCompletion._expressionKeywords = [
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
NameCompletion._openTagCompletion = {
    isIncomplete: false,
    items: [{
            kind: lsp.CompletionItemKind.Keyword,
            label: '<?php',
            insertText: 'php'
        }]
};
NameCompletion._extendsRegex = /\b(?:class|interface)\s+[a-zA-Z_\x80-\xff][a-zA-Z0-9_\x80-\xff]*\s+[a-z]+$/;
NameCompletion._implementsRegex = /\bclass\s+[a-zA-Z_\x80-\xff][a-zA-Z0-9_\x80-\xff]*(?:\s+extends\s+[a-zA-Z_\x80-\xff][a-zA-Z0-9_\x80-\xff]*)?\s+[a-z]+$/;
class ScopedAccessCompletion {
    constructor(config) {
        this.config = config;
    }
    canSuggest(context) {
        let traverser = context.createTraverser();
        let scopedAccessPhrases = [
            149 /* ScopedCallExpression */,
            64 /* ErrorScopedAccessExpression */,
            24 /* ClassConstantAccessExpression */,
            151 /* ScopedPropertyAccessExpression */
        ];
        if (parsedDocument_1.ParsedDocument.isToken(traverser.node, [133 /* ColonColon */])) {
            return parsedDocument_1.ParsedDocument.isPhrase(traverser.parent(), scopedAccessPhrases);
        }
        if (parsedDocument_1.ParsedDocument.isToken(traverser.node, [84 /* VariableName */])) {
            return parsedDocument_1.ParsedDocument.isPhrase(traverser.parent(), [150 /* ScopedMemberName */]);
        }
        if (parsedDocument_1.ParsedDocument.isToken(traverser.node, [90 /* Dollar */])) {
            return parsedDocument_1.ParsedDocument.isPhrase(traverser.parent(), [155 /* SimpleVariable */]) &&
                parsedDocument_1.ParsedDocument.isPhrase(traverser.parent(), [150 /* ScopedMemberName */]);
        }
        return parsedDocument_1.ParsedDocument.isPhrase(traverser.parent(), [94 /* Identifier */]) &&
            parsedDocument_1.ParsedDocument.isPhrase(traverser.parent(), [150 /* ScopedMemberName */]);
    }
    completions(context) {
        let traverser = context.createTraverser();
        let scopedAccessExpr = traverser.ancestor(this._isScopedAccessExpr);
        let accessee = scopedAccessExpr.scope;
        let type = context.resolveExpressionType(accessee);
        let text = context.word;
        let typeNames = type.atomicClassArray();
        if (!typeNames.length) {
            return noCompletionResponse;
        }
        let memberPred = this._createSymbolPredicate(text, 4 /* Private */ | 2 /* Protected */);
        let baseMemberPred = this._createSymbolPredicate(text, 4 /* Private */);
        let ownMemberPred = this._createSymbolPredicate(text, 0);
        let memberQueries = [];
        let typeName;
        let pred;
        for (let n = 0, l = typeNames.length; n < l; ++n) {
            typeName = typeNames[n];
            if (typeName === context.className) {
                pred = ownMemberPred;
            }
            else if (typeName === context.classBaseName) {
                pred = baseMemberPred;
            }
            else {
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
        let items = [];
        for (let n = 0; n < limit; ++n) {
            items.push(this._toCompletionItem(symbols[n]));
        }
        return {
            isIncomplete: isIncomplete,
            items: items
        };
    }
    _toCompletionItem(s) {
        switch (s.kind) {
            case 1024 /* ClassConstant */:
                return toClassConstantCompletionItem(s);
            case 32 /* Method */:
                return toMethodCompletionItem(s);
            case 16 /* Property */:
                return toPropertyCompletionItem(s);
            default:
                throw Error('Invalid Argument');
        }
    }
    _createSymbolPredicate(text, notVisibilityMask) {
        return (s) => {
            return (s.kind === 1024 /* ClassConstant */ ||
                (s.modifiers & 32 /* Static */) > 0) &&
                (!notVisibilityMask || !(s.modifiers & notVisibilityMask)) &&
                util.fuzzyStringMatch(text, s.name);
        };
    }
    _isScopedAccessExpr(node) {
        switch (node.phraseType) {
            case 149 /* ScopedCallExpression */:
            case 64 /* ErrorScopedAccessExpression */:
            case 24 /* ClassConstantAccessExpression */:
            case 151 /* ScopedPropertyAccessExpression */:
                return true;
            default:
                return false;
        }
    }
}
class ObjectAccessCompletion {
    constructor(config) {
        this.config = config;
    }
    canSuggest(context) {
        let traverser = context.createTraverser();
        if (parsedDocument_1.ParsedDocument.isToken(traverser.node, [115 /* Arrow */])) {
            return parsedDocument_1.ParsedDocument.isPhrase(traverser.parent(), [135 /* PropertyAccessExpression */, 111 /* MethodCallExpression */]);
        }
        return parsedDocument_1.ParsedDocument.isPhrase(traverser.parent(), [110 /* MemberName */]);
    }
    completions(context) {
        let traverser = context.createTraverser();
        let objAccessExpr = traverser.ancestor(this._isMemberAccessExpr);
        let type = context.resolveExpressionType(objAccessExpr.variable);
        let typeNames = type.atomicClassArray();
        let text = context.word;
        if (!typeNames.length) {
            return noCompletionResponse;
        }
        let memberPred = this._createMembersPredicate(text);
        let basePred = this._createBaseMembersPredicate(text);
        let ownPred = this._createOwnMembersPredicate(text);
        let typeName;
        let pred;
        let memberQueries = [];
        for (let n = 0, l = typeNames.length; n < l; ++n) {
            typeName = typeNames[n];
            if (typeName === context.className) {
                pred = ownPred;
            }
            else if (typeName === context.classBaseName) {
                pred = basePred;
            }
            else {
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
        let items = [];
        for (let n = 0; n < limit; ++n) {
            items.push(this._toCompletionItem(symbols[n]));
        }
        return {
            isIncomplete: isIncomplete,
            items: items
        };
    }
    _toCompletionItem(s) {
        switch (s.kind) {
            case 32 /* Method */:
                return toMethodCompletionItem(s);
            case 16 /* Property */:
                return toPropertyCompletionItem(s);
            default:
                throw new Error('Invalid Argument');
        }
    }
    _createMembersPredicate(text) {
        return (s) => {
            return (s.kind & (32 /* Method */ | 16 /* Property */)) > 0 &&
                !(s.modifiers & (4 /* Private */ | 2 /* Protected */ | 32 /* Static */)) &&
                util.fuzzyStringMatch(text, s.name);
        };
    }
    _createBaseMembersPredicate(text) {
        return (s) => {
            return (s.kind & (32 /* Method */ | 16 /* Property */)) > 0 &&
                !(s.modifiers & (4 /* Private */ | 32 /* Static */)) &&
                util.fuzzyStringMatch(text, s.name);
        };
    }
    _createOwnMembersPredicate(text) {
        return (s) => {
            return (s.kind & (32 /* Method */ | 16 /* Property */)) > 0 &&
                !(s.modifiers & 32 /* Static */) &&
                util.fuzzyStringMatch(text, s.name);
        };
    }
    _isMemberAccessExpr(node) {
        switch (node.phraseType) {
            case 135 /* PropertyAccessExpression */:
            case 111 /* MethodCallExpression */:
                return true;
            default:
                return false;
        }
    }
}
class TypeDeclarationCompletion extends AbstractNameCompletion {
    canSuggest(context) {
        return parsedDocument_1.ParsedDocument.isToken(context.token, [83 /* Name */, 147 /* Backslash */, 3 /* Array */, 6 /* Callable */]) &&
            context.createTraverser().ancestor((x) => {
                return x.phraseType === 172 /* TypeDeclaration */;
            }) !== null;
    }
    _getKeywords(context) {
        return TypeDeclarationCompletion._keywords;
    }
    _symbolFilter(s) {
        return (s.kind & (1 /* Class */ | 2 /* Interface */)) > 0;
    }
}
TypeDeclarationCompletion._keywords = [
    'self', 'array', 'callable', 'bool', 'float', 'int', 'string'
];
class ClassBaseClauseCompletion extends AbstractNameCompletion {
    canSuggest(context) {
        return context.createTraverser().ancestor(this._isClassBaseClause) !== null;
    }
    _getKeywords(context) {
        return [];
    }
    _symbolFilter(s) {
        return s.kind === 1 /* Class */ &&
            !(s.modifiers & 8 /* Final */);
    }
    _isClassBaseClause(node) {
        return node.phraseType === 23 /* ClassBaseClause */;
    }
}
class InterfaceClauseCompletion extends AbstractNameCompletion {
    canSuggest(context) {
        return context.createTraverser().ancestor(this._isInterfaceClause) !== null;
    }
    _getKeywords() {
        return [];
    }
    _symbolFilter(s) {
        return s.kind === 2 /* Interface */;
    }
    _isInterfaceClause(node) {
        return node.phraseType === 31 /* ClassInterfaceClause */ ||
            node.phraseType === 101 /* InterfaceBaseClause */;
    }
}
class NamespaceDefinitionCompletion {
    constructor(config) {
        this.config = config;
    }
    canSuggest(context) {
        return context.createTraverser().ancestor(this._isNamespaceDefinition) !== null;
    }
    completions(context) {
        let items = [];
        let text = context.word;
        let matches = uniqueSymbolNames(context.symbolStore.match(text, this._symbolFilter, true));
        let limit = Math.min(matches.length, this.config.maxItems - items.length);
        let isIncomplete = matches.length > this.config.maxItems - items.length;
        for (let n = 0; n < limit; ++n) {
            items.push(this._toNamespaceCompletionItem(matches[n]));
        }
        return {
            items: items,
            isIncomplete: isIncomplete
        };
    }
    _toNamespaceCompletionItem(s) {
        return {
            label: s.name,
            kind: lsp.CompletionItemKind.Module
        };
    }
    _symbolFilter(s) {
        return s.kind === 512 /* Namespace */;
    }
    _isNamespaceDefinition(node) {
        return node.phraseType === 119 /* NamespaceDefinition */;
    }
}
class NamespaceUseClauseCompletion {
    constructor(config) {
        this.config = config;
    }
    canSuggest(context) {
        return context.createTraverser().ancestor(this._isNamespaceUseClause) !== null;
    }
    completions(context) {
        let items = [];
        let text = context.word;
        let namespaceUseDecl = context.createTraverser().ancestor(this._isNamespaceUseDeclaration);
        if (!text) {
            return noCompletionResponse;
        }
        let kind = tokenToSymbolKind(namespaceUseDecl.kind) || (1 /* Class */ | 512 /* Namespace */ | 2 /* Interface */);
        let pred = (x) => {
            return (x.kind & kind) > 0 && !(x.modifiers & 4096 /* Use */);
        };
        let matches = uniqueSymbolNames(context.symbolStore.match(text, pred, true).slice(0, this.config.maxItems));
        for (let n = 0, l = matches.length; n < l; ++n) {
            items.push(this._toCompletionItem(matches[n]));
        }
        return {
            isIncomplete: matches.length === this.config.maxItems,
            items: items
        };
    }
    _toCompletionItem(s) {
        let item = lsp.CompletionItem.create(symbol_1.PhpSymbol.notFqn(s.name));
        item.insertText = s.name;
        item.documentation = s.description;
        item.kind = symbolKindToLspSymbolKind(s.kind);
        return item;
    }
    _isNamespaceUseDeclaration(node) {
        return node.phraseType === 123 /* NamespaceUseDeclaration */;
    }
    _isNamespaceUseClause(node) {
        return node.phraseType === 121 /* NamespaceUseClause */;
    }
}
class NamespaceUseGroupClauseCompletion {
    constructor(config) {
        this.config = config;
    }
    canSuggest(context) {
        return context.createTraverser().ancestor(this._isNamespaceUseGroupClause) !== null;
    }
    completions(context) {
        let items = [];
        let text = context.word;
        if (!text) {
            return noCompletionResponse;
        }
        let traverser = context.createTraverser();
        let nsUseGroupClause = traverser.ancestor(this._isNamespaceUseGroupClause);
        let nsUseDecl = traverser.ancestor(this._isNamespaceUseDeclaration);
        let kind = tokenToSymbolKind(nsUseGroupClause.kind || nsUseDecl.kind) || 1 /* Class */;
        let prefix = context.nodeText(nsUseDecl.prefix);
        let pred = (x) => {
            return (x.kind & kind) > 0 && !(x.modifiers & 4096 /* Use */) && (!prefix || x.name.indexOf(prefix) === 0);
        };
        let matches = context.symbolStore.match(text, pred, true).slice(0, this.config.maxItems);
        for (let n = 0, l = matches.length; n < l; ++n) {
            items.push(this._toCompletionItem(matches[n], matches[n].name.slice(prefix.length + 1))); //+1 for \
        }
        return {
            isIncomplete: matches.length === this.config.maxItems,
            items: items
        };
    }
    _toCompletionItem(s, insertText) {
        let item = lsp.CompletionItem.create(symbol_1.PhpSymbol.notFqn(s.name));
        item.insertText = insertText;
        item.documentation = s.description;
        item.kind = symbolKindToLspSymbolKind(s.kind);
        return item;
    }
    _isNamespaceUseGroupClause(node) {
        return node.phraseType === 124 /* NamespaceUseGroupClause */;
    }
    _isNamespaceUseDeclaration(node) {
        return node.phraseType === 123 /* NamespaceUseDeclaration */;
    }
}
class DeclarationBodyCompletion {
    constructor(config) {
        this.config = config;
    }
    canSuggest(context) {
        return parsedDocument_1.ParsedDocument.isPhrase(context.createTraverser().parent(), DeclarationBodyCompletion._phraseTypes);
    }
    completions(context) {
        let text = context.word;
        return {
            items: keywordCompletionItems(DeclarationBodyCompletion._keywords, text)
        };
    }
}
DeclarationBodyCompletion._phraseTypes = [
    29 /* ClassDeclarationBody */, 103 /* InterfaceDeclarationBody */, 165 /* TraitDeclarationBody */,
    60 /* ErrorClassMemberDeclaration */
];
DeclarationBodyCompletion._keywords = [
    'var', 'public', 'private', 'protected', 'final', 'function', 'abstract', 'implements', 'extends'
];
class MethodDeclarationHeaderCompletion {
    constructor(config) {
        this.config = config;
    }
    canSuggest(context) {
        let traverser = context.createTraverser();
        let thisSymbol = context.classSymbol;
        return parsedDocument_1.ParsedDocument.isPhrase(traverser.parent(), [94 /* Identifier */]) &&
            parsedDocument_1.ParsedDocument.isPhrase(traverser.parent(), [114 /* MethodDeclarationHeader */]) &&
            !!thisSymbol && !!thisSymbol.associated && thisSymbol.associated.length > 0;
    }
    completions(context) {
        let text = context.word;
        let memberDecl = context.createTraverser().ancestor((x) => {
            return x.phraseType === 114 /* MethodDeclarationHeader */;
        });
        let modifiers = symbolReader_1.SymbolReader.modifierListElementsToSymbolModifier(memberDecl.modifierList ? memberDecl.modifierList.elements : []);
        modifiers &= (1 /* Public */ | 2 /* Protected */);
        let existingMethodNames = [];
        if (context.classSymbol.children) {
            existingMethodNames = context.classSymbol.children.filter((x) => {
                return x.kind === 32 /* Method */;
            }).map((x) => {
                return x.name;
            });
        }
        let classPred = (x) => {
            return x.kind === 32 /* Method */ &&
                (!modifiers || (x.modifiers & modifiers) > 0) &&
                !(x.modifiers & (8 /* Final */ | 4 /* Private */)) &&
                existingMethodNames.indexOf(x.name) < 0 &&
                util.fuzzyStringMatch(text, x.name);
        };
        let interfacePred = (x) => {
            return x.kind === 32 /* Method */ &&
                existingMethodNames.indexOf(x.name) < 0 &&
                util.fuzzyStringMatch(text, x.name);
        };
        let queries = context.classSymbol.associated.filter((x) => {
            return (x.kind & (1 /* Class */ | 2 /* Interface */)) > 0;
        }).map((x) => {
            return {
                typeName: x.name,
                memberPredicate: x.kind === 2 /* Interface */ ? interfacePred : classPred
            };
        });
        let matches = context.symbolStore.lookupMembersOnTypes(queries).slice(0, this.config.maxItems);
        let items = [];
        for (let n = 0, l = matches.length; n < l; ++n) {
            items.push(this._toCompletionItem(matches[n]));
        }
        return {
            isIncomplete: matches.length === this.config.maxItems,
            items: items
        };
    }
    _toCompletionItem(s) {
        let params = s.children ? s.children.filter((x) => {
            return x.kind === 128 /* Parameter */;
        }) : [];
        let paramStrings = [];
        for (let n = 0, l = params.length; n < l; ++n) {
            paramStrings.push(this._parameterToString(params[n]));
        }
        let paramString = paramStrings.join(', ');
        let escapedParamString = snippetEscape(paramString);
        let insertText = `${s.name}(${escapedParamString}) {$0}`;
        let item = {
            kind: lsp.CompletionItemKind.Method,
            label: s.name,
            insertText: insertText,
            insertTextFormat: lsp.InsertTextFormat.Snippet,
            documentation: s.description,
            detail: s.scope
        };
        return item;
    }
    _parameterToString(s) {
        let parts = [];
        if (s.type && !s.type.isEmpty() && s.typeSource === 1 /* TypeDeclaration */) {
            let typeName = s.type.atomicClassArray().shift();
            if (typeName) {
                typeName = '\\' + typeName;
            }
            else {
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
function snippetEscape(text) {
    return text.replace(snippetEscapeRegex, snippetEscapeReplacer);
}
function snippetEscapeReplacer(match, offset, subject) {
    return '\\' + match;
}
