/* Copyright (c) Ben Mewburn ben@mewburn.id.au
 * Licensed under the MIT Licence.
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
function toNameCompletionItem(s, namespace, namePhraseType) {
    let label = nameLabel(s, namespace, namePhraseType);
    switch (s.kind) {
        case 1 /* Class */:
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
        kind: lsp.CompletionItemKind.Class,
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
    return {
        kind: lsp.CompletionItemKind.Method,
        label: s.name,
        documentation: s.description,
        detail: symbol_1.PhpSymbol.signatureString(s)
    };
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
class CompletionProvider {
    constructor(symbolStore, documentStore, maxSuggestions) {
        this.symbolStore = symbolStore;
        this.documentStore = documentStore;
        this.maxSuggestions = maxSuggestions;
        this._strategies = [
            new ClassTypeDesignatorCompletion(maxSuggestions),
            new ScopedAccessCompletion(this.symbolStore, maxSuggestions),
            new ObjectAccessCompletion(this.symbolStore, this.maxSuggestions),
            new SimpleVariableCompletion(maxSuggestions),
            new NameCompletion(this.maxSuggestions)
        ];
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
    _importedSymbolFilter(s) {
        return (s.modifiers & 4096 /* Use */) > 0 &&
            (s.kind & (1 /* Class */ | 8 /* Constant */ | 64 /* Function */)) > 0;
    }
    _phraseType(p) {
        return p.phraseType;
    }
}
exports.CompletionProvider = CompletionProvider;
class ClassTypeDesignatorCompletion {
    constructor(maxSuggestions) {
        this.maxSuggestions = maxSuggestions;
    }
    canSuggest(context) {
        let traverser = context.createTraverser();
        return parsedDocument_1.ParsedDocument.isToken(traverser.node, [147 /* Backslash */, 83 /* Name */]) &&
            parsedDocument_1.ParsedDocument.isPhrase(traverser.parent(), [119 /* NamespaceName */]) &&
            parsedDocument_1.ParsedDocument.isPhrase(traverser.parent(), [83 /* FullyQualifiedName */, 139 /* QualifiedName */, 142 /* RelativeQualifiedName */]) &&
            parsedDocument_1.ParsedDocument.isPhrase(traverser.parent(), [34 /* ClassTypeDesignator */]);
    }
    completions(context) {
        let items = [];
        let traverser = context.createTraverser();
        let nsNameNode = traverser.parent();
        let qNameNode = traverser.parent();
        let text = context.word;
        if (!text) {
            return noCompletionResponse;
        }
        if (qNameNode.phraseType === 139 /* QualifiedName */) {
            Array.prototype.push.apply(items, keywordCompletionItems(ClassTypeDesignatorCompletion._keywords, text));
        }
        if (qNameNode.phraseType === 142 /* RelativeQualifiedName */) {
            text = context.resolveFqn(qNameNode, 1 /* Class */);
        }
        let matches = context.symbolStore.match(text, this._symbolFilter);
        let limit = Math.min(matches.length, this.maxSuggestions - items.length);
        let isIncomplete = matches.length > this.maxSuggestions - items.length;
        for (let n = 0; n < limit; ++n) {
            items.push(toConstructorCompletionItem(matches[n], nameLabel(matches[n], context.namespaceName, qNameNode.phraseType)));
        }
        return {
            items: items,
            isIncomplete: isIncomplete
        };
    }
    _symbolFilter(s) {
        return s.kind === 1 /* Class */ &&
            !(s.modifiers & (512 /* Anonymous */ | 16 /* Abstract */));
    }
}
ClassTypeDesignatorCompletion._keywords = [
    'class', 'static', 'namespace'
];
class SimpleVariableCompletion {
    constructor(maxSuggestions) {
        this.maxSuggestions = maxSuggestions;
    }
    canSuggest(context) {
        let traverser = context.createTraverser();
        return parsedDocument_1.ParsedDocument.isToken(traverser.node, [90 /* Dollar */, 84 /* VariableName */]) &&
            parsedDocument_1.ParsedDocument.isPhrase(traverser.parent(), [154 /* SimpleVariable */]);
    }
    completions(context) {
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
        let limit = Math.min(varSymbols.length, this.maxSuggestions);
        let isIncomplete = varSymbols.length > this.maxSuggestions;
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
class NameCompletion {
    constructor(maxSuggestions) {
        this.maxSuggestions = maxSuggestions;
    }
    canSuggest(context) {
        let traverser = context.createTraverser();
        return parsedDocument_1.ParsedDocument.isToken(traverser.node, [147 /* Backslash */, 83 /* Name */]) &&
            parsedDocument_1.ParsedDocument.isPhrase(traverser.parent(), [119 /* NamespaceName */]) &&
            parsedDocument_1.ParsedDocument.isPhrase(traverser.parent(), [83 /* FullyQualifiedName */, 139 /* QualifiedName */, 142 /* RelativeQualifiedName */]);
    }
    completions(context) {
        let items = [];
        let traverser = context.createTraverser();
        let nsNameNode = traverser.parent();
        let qNameNode = traverser.parent();
        let qNameParent = traverser.parent();
        let text = context.word;
        if (!text) {
            return noCompletionResponse;
        }
        if (qNameNode.phraseType === 139 /* QualifiedName */) {
            Array.prototype.push.apply(items, keywordCompletionItems(NameCompletion._expressionKeywords, text));
            if (qNameParent.phraseType === 155 /* StatementList */) {
                Array.prototype.push.apply(items, keywordCompletionItems(NameCompletion._statementKeywords, text));
            }
        }
        if (qNameNode.phraseType === 142 /* RelativeQualifiedName */) {
            text = context.resolveFqn(qNameNode, 1 /* Class */);
        }
        let matches = context.symbolStore.match(text, this._symbolFilter);
        let limit = Math.min(matches.length, this.maxSuggestions - items.length);
        let isIncomplete = matches.length > this.maxSuggestions - items.length;
        for (let n = 0; n < limit; ++n) {
            items.push(toNameCompletionItem(matches[n], context.namespaceName, qNameNode.phraseType));
        }
        return {
            items: items,
            isIncomplete: isIncomplete
        };
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
    constructor(symbolStore, maxSuggestions) {
        this.symbolStore = symbolStore;
        this.maxSuggestions = maxSuggestions;
    }
    canSuggest(context) {
        let traverser = context.createTraverser();
        let scopedAccessPhrases = [
            148 /* ScopedCallExpression */,
            64 /* ErrorScopedAccessExpression */,
            24 /* ClassConstantAccessExpression */,
            150 /* ScopedPropertyAccessExpression */
        ];
        if (parsedDocument_1.ParsedDocument.isToken(traverser.node, [133 /* ColonColon */])) {
            return parsedDocument_1.ParsedDocument.isPhrase(traverser.parent(), scopedAccessPhrases);
        }
        if (parsedDocument_1.ParsedDocument.isToken(traverser.node, [84 /* VariableName */])) {
            return parsedDocument_1.ParsedDocument.isPhrase(traverser.parent(), [149 /* ScopedMemberName */]);
        }
        if (parsedDocument_1.ParsedDocument.isToken(traverser.node, [90 /* Dollar */])) {
            return parsedDocument_1.ParsedDocument.isPhrase(traverser.parent(), [154 /* SimpleVariable */]) &&
                parsedDocument_1.ParsedDocument.isPhrase(traverser.parent(), [149 /* ScopedMemberName */]);
        }
        return parsedDocument_1.ParsedDocument.isPhrase(traverser.parent(), [93 /* Identifier */]) &&
            parsedDocument_1.ParsedDocument.isPhrase(traverser.parent(), [149 /* ScopedMemberName */]);
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
        let symbols = this.symbolStore.lookupMembersOnTypes(memberQueries);
        let isIncomplete = symbols.length > this.maxSuggestions;
        let limit = Math.min(symbols.length, this.maxSuggestions);
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
            case 148 /* ScopedCallExpression */:
            case 64 /* ErrorScopedAccessExpression */:
            case 24 /* ClassConstantAccessExpression */:
            case 150 /* ScopedPropertyAccessExpression */:
                return true;
            default:
                return false;
        }
    }
}
class ObjectAccessCompletion {
    constructor(symbolStore, maxSuggestions) {
        this.symbolStore = symbolStore;
        this.maxSuggestions = maxSuggestions;
    }
    canSuggest(context) {
        let traverser = context.createTraverser();
        if (parsedDocument_1.ParsedDocument.isToken(traverser.node, [115 /* Arrow */])) {
            return parsedDocument_1.ParsedDocument.isPhrase(traverser.parent(), [134 /* PropertyAccessExpression */, 110 /* MethodCallExpression */]);
        }
        return parsedDocument_1.ParsedDocument.isToken(traverser.node, [83 /* Name */]) &&
            parsedDocument_1.ParsedDocument.isPhrase(traverser.parent(), [134 /* PropertyAccessExpression */, 110 /* MethodCallExpression */]);
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
        let symbols = this.symbolStore.lookupMembersOnTypes(memberQueries);
        let isIncomplete = symbols.length > this.maxSuggestions;
        let limit = Math.min(symbols.length, this.maxSuggestions);
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
            case 134 /* PropertyAccessExpression */:
            case 110 /* MethodCallExpression */:
                return true;
            default:
                return false;
        }
    }
}
