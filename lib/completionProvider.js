/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const symbol_1 = require("./symbol");
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
function nameLabel(s, nsName, namePhraseType) {
    let label = s.name;
    if (nsName && s.name.indexOf(nsName) === 0 && label.length > nsName.length + 1) {
        label = label.slice(nsName.length + 1);
    }
    else if (nsName && namePhraseType !== 83 /* FullyQualifiedName */ && !(s.modifiers & 4096 /* Use */)) {
        label = '\\' + label;
    }
    return label;
}
function toNameCompletionItem(s, label) {
    switch (s.kind) {
        case 1 /* Class */:
        case 2 /* Interface */:
            return toClassCompletionItem(s, label);
        case 64 /* Function */:
            return toFunctionCompletionItem(s, label);
        case 8 /* Constant */:
            return toConstantCompletionItem(s, label);
        default:
            throw new Error('Invalid Argument');
    }
}
function symbolKindToLspSymbolKind(kind) {
    switch (kind) {
        case 1 /* Class */:
            return lsp.SymbolKind.Class;
        case 64 /* Function */:
            return lsp.SymbolKind.Function;
        case 8 /* Constant */:
            return lsp.SymbolKind.Constant;
        default:
            return lsp.SymbolKind.String;
    }
}
function toClassCompletionItem(s, label) {
    return {
        kind: s.kind === 2 /* Interface */ ? lsp.CompletionItemKind.Interface : lsp.CompletionItemKind.Class,
        label: label ? label : s.name,
        documentation: s.description
    };
}
function toFunctionCompletionItem(s, label) {
    let item = {
        kind: lsp.CompletionItemKind.Function,
        label: label ? label : s.name,
        documentation: s.description,
        detail: symbol_1.PhpSymbol.signatureString(s)
    };
    return item;
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
        item.sortText = 'z';
    }
    return item;
}
function toClassConstantCompletionItem(s) {
    return {
        kind: lsp.CompletionItemKind.Value,
        label: s.name,
        documentation: s.description,
        detail: s.value
    };
}
function toConstantCompletionItem(s, label) {
    return {
        kind: lsp.CompletionItemKind.Value,
        label: label ? label : s.name,
        documentation: s.description,
        detail: s.value
    };
}
function toPropertyCompletionItem(s) {
    return {
        kind: lsp.CompletionItemKind.Property,
        label: !(s.modifiers & 32 /* Static */) ? s.name.slice(1) : s.name,
        documentation: s.description,
        detail: s.type ? s.type.toString() : ''
    };
}
function toConstructorCompletionItem(s, label) {
    return {
        kind: lsp.CompletionItemKind.Constructor,
        label: label ? label : s.name,
        documentation: s.description
    };
}
function toVariableCompletionItem(s) {
    return {
        label: s.name,
        kind: lsp.SymbolKind.Variable,
        documentation: s.description
    };
}
function toNamespaceCompletionItem(s) {
    return {
        label: s.name,
        kind: lsp.SymbolKind.Namespace
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
    constructor(symbolStore, documentStore) {
        this.symbolStore = symbolStore;
        this.documentStore = documentStore;
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
            new TypeDeclarationCompletion(),
            new MethodDeclarationHeaderCompletion(),
            new DeclarationBodyCompletion(),
            new NameCompletion()
        ];
    }
    set maxItems(value) {
        this._maxItems = value;
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
        return strategy ? strategy.completions(context, this._maxItems) : noCompletionResponse;
    }
    _importedSymbolFilter(s) {
        return (s.modifiers & 4096 /* Use */) > 0 &&
            (s.kind & (1 /* Class */ | 8 /* Constant */ | 64 /* Function */)) > 0;
    }
    _phraseType(p) {
        return p.phraseType;
    }
}
exports.CompletionProvider = CompletionProvider;
class AbstractNameCompletion {
    completions(context, maxItems) {
        let items = [];
        let namePhrase = this._getNamePhrase(context);
        let text = context.word;
        if (!text) {
            return noCompletionResponse;
        }
        Array.prototype.push.apply(items, keywordCompletionItems(this._getKeywords(context), text));
        let pred = this._symbolFilter;
        if (namePhrase && namePhrase.phraseType === 143 /* RelativeQualifiedName */) {
            let ns = context.namespaceName;
            pred = (x) => {
                return this._symbolFilter && x.name.indexOf(ns) === 0;
            };
        }
        let matches = context.symbolStore.match(text, pred, true);
        let limit = Math.min(matches.length, maxItems - items.length);
        let isIncomplete = matches.length > maxItems - items.length;
        let toCompletionItem;
        for (let n = 0; n < limit; ++n) {
            items.push(this._toCompletionItem(matches[n], nameLabel(matches[n], context.namespaceName, namePhrase ? namePhrase.phraseType : 0)));
        }
        return {
            items: items,
            isIncomplete: isIncomplete
        };
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
}
class ClassTypeDesignatorCompletion extends AbstractNameCompletion {
    canSuggest(context) {
        let traverser = context.createTraverser();
        return parsedDocument_1.ParsedDocument.isToken(traverser.node, [147 /* Backslash */, 83 /* Name */]) &&
            parsedDocument_1.ParsedDocument.isPhrase(traverser.parent(), [120 /* NamespaceName */]) &&
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
    _toCompletionItem(s, label) {
        return toConstructorCompletionItem(s, label);
    }
    _isQualifiedName(node) {
        return node.phraseType === 140 /* QualifiedName */;
    }
}
ClassTypeDesignatorCompletion._keywords = [
    'class', 'static', 'namespace'
];
class SimpleVariableCompletion {
    canSuggest(context) {
        let traverser = context.createTraverser();
        return parsedDocument_1.ParsedDocument.isToken(traverser.node, [90 /* Dollar */, 84 /* VariableName */]) &&
            parsedDocument_1.ParsedDocument.isPhrase(traverser.parent(), [155 /* SimpleVariable */]);
    }
    completions(context, maxItems) {
        let nameResolver = context.createNameResolver();
        let text = context.word;
        if (!text) {
            return noCompletionResponse;
        }
        let scope = context.scopeSymbol;
        let symbolMask = 256 /* Variable */ | 128 /* Parameter */;
        let varSymbols = scope.children.filter((x) => {
            return (x.kind & symbolMask) > 0 && x.name.indexOf(text) === 0;
        });
        //also suggest built in globals vars
        Array.prototype.push.apply(varSymbols, context.symbolStore.match(text, this._isBuiltInGlobalVar));
        let limit = Math.min(varSymbols.length, maxItems);
        let isIncomplete = varSymbols.length > maxItems;
        let items = [];
        for (let n = 0; n < limit; ++n) {
            items.push(toVariableCompletionItem(varSymbols[n]));
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
        //<?php (no trailing space) is considered short tag open and then name token
        //dont suggest in this context
        if (context.textBefore(3) === '<?p' ||
            context.textBefore(4) === '<?ph' ||
            context.textBefore(5) === '<?php') {
            return false;
        }
        let traverser = context.createTraverser();
        return parsedDocument_1.ParsedDocument.isToken(traverser.node, [147 /* Backslash */, 83 /* Name */]) &&
            parsedDocument_1.ParsedDocument.isPhrase(traverser.parent(), [120 /* NamespaceName */]) &&
            parsedDocument_1.ParsedDocument.isPhrase(traverser.parent(), [83 /* FullyQualifiedName */, 140 /* QualifiedName */, 143 /* RelativeQualifiedName */]);
    }
    _toCompletionItem(s, label) {
        return toNameCompletionItem(s, label);
    }
    _getKeywords(context) {
        return [...NameCompletion._expressionKeywords, ...NameCompletion._statementKeywords];
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
    'yield'
];
class ScopedAccessCompletion {
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
    completions(context, maxItems) {
        let traverser = context.createTraverser();
        let scopedAccessExpr = traverser.ancestor(this._isScopedAccessExpr);
        let accessee = scopedAccessExpr.scope;
        let type = context.resolveExpressionType(accessee);
        let text = context.word;
        let typeNames = type.atomicClassArray();
        if (!typeNames.length) {
            return noCompletionResponse;
        }
        let memberPred = this._createMembersPredicate(text);
        let baseMemberPred = this._createBaseMembersPredicate(text);
        let ownMemberPred = this._createOwnMembersPredicate(text);
        let memberQueries = [];
        let typeName;
        let pred;
        for (let n = 0, l = typeNames.length; n < l; ++n) {
            typeName = typeNames[n];
            if (typeName === context.thisName) {
                pred = ownMemberPred;
            }
            else if (typeName === context.thisBaseName) {
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
        let isIncomplete = symbols.length > maxItems;
        let limit = Math.min(symbols.length, maxItems);
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
    _createMembersPredicate(text) {
        return (s) => {
            return (((s.kind & (32 /* Method */ | 16 /* Property */)) > 0 &&
                (s.modifiers & 32 /* Static */) > 0) ||
                s.kind === 1024 /* ClassConstant */) &&
                !(s.modifiers & (4 /* Private */ | 2 /* Protected */)) &&
                util.fuzzyStringMatch(text, s.name);
        };
    }
    _createBaseMembersPredicate(text) {
        return (s) => {
            return (((s.kind & (32 /* Method */ | 16 /* Property */)) > 0 &&
                (s.modifiers & 32 /* Static */) > 0) ||
                s.kind === 1024 /* ClassConstant */) &&
                !(s.modifiers & 4 /* Private */) &&
                util.fuzzyStringMatch(text, s.name);
        };
    }
    _createOwnMembersPredicate(text) {
        return (s) => {
            return (((s.kind & (32 /* Method */ | 16 /* Property */)) > 0 &&
                (s.modifiers & 32 /* Static */) > 0) ||
                s.kind === 1024 /* ClassConstant */) &&
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
    canSuggest(context) {
        let traverser = context.createTraverser();
        if (parsedDocument_1.ParsedDocument.isToken(traverser.node, [115 /* Arrow */])) {
            return parsedDocument_1.ParsedDocument.isPhrase(traverser.parent(), [135 /* PropertyAccessExpression */, 111 /* MethodCallExpression */]);
        }
        return parsedDocument_1.ParsedDocument.isToken(traverser.node, [83 /* Name */]) &&
            parsedDocument_1.ParsedDocument.isPhrase(traverser.parent(), [110 /* MemberName */]);
    }
    completions(context, maxItems) {
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
            if (typeName === context.thisName) {
                pred = ownPred;
            }
            else if (typeName === context.thisBaseName) {
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
        let isIncomplete = symbols.length > maxItems;
        let limit = Math.min(symbols.length, maxItems);
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
                !(s.modifiers & 4 /* Private */ | 32 /* Static */) &&
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
    _toCompletionItem(s, label) {
        return toClassCompletionItem(s, label);
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
        return parsedDocument_1.ParsedDocument.isToken(context.token, [83 /* Name */, 147 /* Backslash */]) &&
            context.createTraverser().ancestor(this._isClassBaseClause) !== null;
    }
    _getKeywords(context) {
        return [];
    }
    _symbolFilter(s) {
        return s.kind === 1 /* Class */ &&
            !(s.modifiers & 8 /* Final */);
    }
    _toCompletionItem(s, label) {
        return toClassCompletionItem(s, label);
    }
    _isClassBaseClause(node) {
        return node.phraseType === 23 /* ClassBaseClause */;
    }
}
class InterfaceClauseCompletion extends AbstractNameCompletion {
    canSuggest(context) {
        return parsedDocument_1.ParsedDocument.isToken(context.token, [83 /* Name */, 147 /* Backslash */]) &&
            context.createTraverser().ancestor(this._isInterfaceClause) !== null;
    }
    _getKeywords() {
        return [];
    }
    _symbolFilter(s) {
        return s.kind === 2 /* Interface */;
    }
    _toCompletionItem(s, label) {
        return toClassCompletionItem(s, label);
    }
    _isInterfaceClause(node) {
        return node.phraseType === 31 /* ClassInterfaceClause */ ||
            node.phraseType === 101 /* InterfaceBaseClause */;
    }
}
class NamespaceDefinitionCompletion {
    canSuggest(context) {
        return parsedDocument_1.ParsedDocument.isToken(context.token, [83 /* Name */, 147 /* Backslash */]) &&
            context.createTraverser().ancestor(this._isNamespaceDefinition) !== null;
    }
    completions(context, maxItems) {
        let items = [];
        let text = context.word;
        let matches = uniqueSymbolNames(context.symbolStore.match(text, this._symbolFilter, true));
        let limit = Math.min(matches.length, maxItems - items.length);
        let isIncomplete = matches.length > maxItems - items.length;
        for (let n = 0; n < limit; ++n) {
            items.push(toNamespaceCompletionItem(matches[n]));
        }
        return {
            items: items,
            isIncomplete: isIncomplete
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
    canSuggest(context) {
        return parsedDocument_1.ParsedDocument.isToken(context.token, [83 /* Name */, 147 /* Backslash */]) &&
            context.createTraverser().ancestor(this._isNamespaceUseClause) !== null;
    }
    completions(context, maxItems) {
        let items = [];
        let text = context.word;
        let namespaceUseDecl = context.createTraverser().ancestor(this._isNamespaceUseDeclaration);
        if (!text) {
            return noCompletionResponse;
        }
        let kind = tokenToSymbolKind(namespaceUseDecl.kind) || (1 /* Class */ | 512 /* Namespace */);
        let pred = (x) => {
            return x.kind === kind && !(x.modifiers & 4096 /* Use */);
        };
        let matches = context.symbolStore.match(text, pred, true).slice(0, maxItems);
        for (let n = 0, l = matches.length; n < l; ++n) {
            items.push(toNameCompletionItem(matches[n]));
        }
        return {
            isIncomplete: matches.length === maxItems,
            items: items
        };
    }
    _isNamespaceUseDeclaration(node) {
        return node.phraseType === 123 /* NamespaceUseDeclaration */;
    }
    _isNamespaceUseClause(node) {
        return node.phraseType === 121 /* NamespaceUseClause */;
    }
}
class NamespaceUseGroupClauseCompletion {
    canSuggest(context) {
        return parsedDocument_1.ParsedDocument.isToken(context.token, [83 /* Name */, 147 /* Backslash */]) &&
            context.createTraverser().ancestor(this._isNamespaceUseGroupClause) !== null;
    }
    completions(context, maxItems) {
        let items = [];
        let text = context.word;
        if (!text) {
            return noCompletionResponse;
        }
        let traverser = context.createTraverser();
        let nsUseGroupClause = traverser.ancestor(this._isNamespaceUseGroupClause);
        let nsUseDecl = traverser.ancestor(this._isNamespaceUseDeclaration);
        let kind = tokenToSymbolKind(nsUseGroupClause.kind || nsUseDecl.kind) || (1 /* Class */ | 512 /* Namespace */);
        let prefix = context.nodeText(nsUseDecl.prefix);
        let pred = (x) => {
            return (x.kind & kind) > 0 && !(x.modifiers & 4096 /* Use */) && (!prefix || x.name.indexOf(prefix) === 0);
        };
        let matches = context.symbolStore.match(text, pred, true).slice(maxItems);
        for (let n = 0, l = matches.length; n < l; ++n) {
            items.push(toNameCompletionItem(matches[n], matches[n].name.slice(prefix.length)));
        }
        return {
            isIncomplete: matches.length === maxItems,
            items: items
        };
    }
    _isNamespaceUseGroupClause(node) {
        return node.phraseType === 124 /* NamespaceUseGroupClause */;
    }
    _isNamespaceUseDeclaration(node) {
        return node.phraseType === 123 /* NamespaceUseDeclaration */;
    }
}
class DeclarationBodyCompletion {
    canSuggest(context) {
        return parsedDocument_1.ParsedDocument.isToken(context.token, [83 /* Name */]) &&
            parsedDocument_1.ParsedDocument.isPhrase(context.createTraverser().parent(), DeclarationBodyCompletion._phraseTypes) !== null;
    }
    completions(context, maxItems) {
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
    canSuggest(context) {
        let traverser = context.createTraverser();
        let thisSymbol = context.thisSymbol;
        return parsedDocument_1.ParsedDocument.isPhrase(traverser.parent(), [94 /* Identifier */]) &&
            parsedDocument_1.ParsedDocument.isPhrase(traverser.parent(), [114 /* MethodDeclarationHeader */]) &&
            !!thisSymbol && !!thisSymbol.associated && thisSymbol.associated.length > 0;
    }
    completions(context, maxItems) {
        let text = context.word;
        let memberDecl = context.createTraverser().ancestor((x) => {
            return x.phraseType === 114 /* MethodDeclarationHeader */;
        });
        let modifiers = symbol_1.SymbolReader.modifierListElementsToSymbolModifier(memberDecl.modifierList ? memberDecl.modifierList.elements : []);
        modifiers &= (1 /* Public */ | 2 /* Protected */);
        let existingMethodNames = [];
        if (context.thisSymbol.children) {
            existingMethodNames = context.thisSymbol.children.filter((x) => {
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
        let queries = context.thisSymbol.associated.filter((x) => {
            return (x.kind & (1 /* Class */ | 2 /* Interface */)) > 0;
        }).map((x) => {
            return {
                typeName: x.name,
                memberPredicate: x.kind === 2 /* Interface */ ? interfacePred : classPred
            };
        });
        let matches = context.symbolStore.lookupMembersOnTypes(queries).slice(0, maxItems);
        let items = [];
        for (let n = 0, l = matches.length; n < l; ++n) {
            items.push(this._toCompletionItem(matches[n]));
        }
        return {
            isIncomplete: matches.length === maxItems,
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
        let label = `${s.name}(${paramString}) {}`;
        let insertText = `${s.name}(${escapedParamString}) {$0}`;
        let item = {
            kind: lsp.CompletionItemKind.Method,
            label: label,
            insertText: insertText,
            insertTextFormat: lsp.InsertTextFormat.Snippet
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
