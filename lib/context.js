/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const symbol_1 = require("./symbol");
const types_1 = require("./types");
const parsedDocument_1 = require("./parsedDocument");
class ContextVisitor {
    constructor(offset) {
        this.offset = offset;
        this.haltTraverse = false;
    }
    get spine() {
        return this._spine;
    }
    get namespaceDefinition() {
        return this._namespaceDefinition;
    }
    preOrder(node, spine) {
        if (this.haltTraverse) {
            return false;
        }
        if (parsedDocument_1.ParsedDocument.isOffsetInToken(this.offset, node)) {
            this.haltTraverse = true;
            this._spine = spine.slice(0);
            this._spine.push(node);
            return false;
        }
        if (node.phraseType === 119 /* NamespaceDefinition */) {
            this._namespaceDefinition = node;
        }
        return true;
    }
    postOrder(node, spine) {
        if (this.haltTraverse) {
            return;
        }
        if (node.phraseType === 119 /* NamespaceDefinition */ &&
            node.statementList) {
            this._namespaceDefinition = undefined;
        }
    }
}
class Context {
    constructor(symbolStore, document, position) {
        this.symbolStore = symbolStore;
        this.document = document;
        this.position = position;
        this._offset = document.offsetAtPosition(position) - 1;
        let contextVisitor = new ContextVisitor(this._offset);
        document.traverse(contextVisitor);
        this._namespaceDefinition = contextVisitor.namespaceDefinition;
        this._parseTreeSpine = contextVisitor.spine;
    }
    get word() {
        return this.document.wordAtOffset(this._offset);
    }
    get token() {
        return this._parseTreeSpine.length ? this._parseTreeSpine[this._parseTreeSpine.length - 1] : null;
    }
    get offset() {
        return this.document.offsetAtPosition(this.position);
    }
    get spine() {
        return this._parseTreeSpine.slice(0);
    }
    get thisName() {
        let s = this.thisSymbol;
        return s ? s.name : '';
    }
    get thisBaseName() {
        let s = this.thisBaseSymbol;
        return s ? s.name : '';
    }
    get namespaceName() {
        if (this._namespaceName === undefined) {
            if (this.namespacePhrase) {
                this._namespaceName = this.nodeText(this.namespacePhrase.name, [161 /* Whitespace */]);
            }
            else {
                this._namespaceName = '';
            }
        }
        return this._namespaceName;
    }
    get namespacePhrase() {
        if (this._namespaceDefinition === undefined) {
            let traverser = this.createTraverser();
            let nsDef = traverser.ancestor(this._isNamespaceDefinition);
            if (!nsDef) {
                traverser.up(traverser.depth() - 2);
                while (nsDef = traverser.prevSibling()) {
                    if (this._isNamespaceDefinition(nsDef)) {
                        break;
                    }
                }
            }
            this._namespaceDefinition = nsDef;
        }
        return this._namespaceDefinition;
    }
    get thisPhrase() {
        if (this._thisPhrase === undefined) {
            let traverser = this.createTraverser();
            this._thisPhrase = traverser.ancestor(this._isClassDeclaration);
        }
        return this._thisPhrase;
    }
    get thisSymbol() {
        if (this._thisSymbol === undefined) {
            let phrase = this.thisPhrase;
            if (phrase) {
                let symbolTable = this.symbolStore.getSymbolTable(this.document.uri);
                let phrasePos = this.document.phraseRange(phrase).start;
                this._thisSymbol = symbolTable.symbolAtPosition(phrasePos);
            }
            else {
                this._thisSymbol = null;
            }
        }
        return this._thisSymbol;
    }
    get thisBaseSymbol() {
        if (this._thisBaseSymbol === undefined) {
            let thisSymbol = this.thisSymbol;
            if (!thisSymbol || !thisSymbol.associated) {
                this._thisBaseSymbol = null;
            }
            else {
                this._thisBaseSymbol = thisSymbol.associated.find((x) => {
                    return x.kind === 1 /* Class */;
                });
            }
        }
        return this._thisBaseSymbol;
    }
    get scopePhrase() {
        if (!this._scopePhrase) {
            let t = this.createTraverser();
            //need to get scope body first to exclude chance 
            //that position is within a scope declaration
            t.ancestor(this._isScopeBody);
            this._scopePhrase = t.ancestor(this._isScopePhrase);
            if (!this._scopePhrase) {
                this._scopePhrase = this._parseTreeSpine[0];
            }
        }
        return this._scopePhrase;
    }
    get scopeSymbol() {
        if (!this._scopeSymbol) {
            let phrase = this.scopePhrase;
            let symbolTable = this.symbolStore.getSymbolTable(this.document.uri);
            let phrasePos = this.document.phraseRange(phrase).start;
            this._scopeSymbol = symbolTable.symbolAtPosition(phrasePos);
            if (!this._scopeSymbol) {
                this._scopeSymbol = symbolTable.root;
            }
        }
        return this._scopeSymbol;
    }
    get variableTable() {
        if (!this._variableTable) {
            let varTypeResolver = new symbol_1.VariableTypeResolver(new symbol_1.VariableTable(), this.document, this.createNameResolver(), this.symbolStore, this.token);
            let scope = this.scopePhrase;
            let traverser = new types_1.TreeTraverser([scope]);
            traverser.traverse(varTypeResolver);
            this._variableTable = varTypeResolver.variableTable;
        }
        return this._variableTable;
    }
    textBefore(length) {
        return this.document.textBeforeOffset(this._offset, length);
    }
    tokenText(t) {
        return this.document.tokenText(t);
    }
    nodeText(node, ignore) {
        return this.document.nodeText(node, ignore);
    }
    resolveFqn(phrase, kind) {
        let nameResolver = this.createNameResolver();
        return nameResolver.namePhraseToFqn(phrase, kind);
    }
    resolveExpressionType(expr) {
        let exprResolver = this.createExpressionTypeResolver();
        return exprResolver.resolveExpression(expr);
    }
    createNameResolver() {
        let symbolTable = this.symbolStore.getSymbolTable(this.document.uri);
        let imported = symbolTable ? symbolTable.filter(this._importFilter) : [];
        let namespaceName = this.namespaceName;
        let thisName = this.thisName;
        let baseName = this.thisBaseName;
        return new symbol_1.NameResolver(this.document, imported, namespaceName, thisName, baseName);
    }
    createTraverser() {
        return new types_1.TreeTraverser(this._parseTreeSpine);
    }
    createExpressionTypeResolver() {
        return new symbol_1.ExpressionTypeResolver(this.createNameResolver(), this.symbolStore, this.variableTable);
    }
    _isScopePhrase(p) {
        switch (p.phraseType) {
            case 85 /* FunctionDeclaration */:
            case 112 /* MethodDeclaration */:
            case 4 /* AnonymousFunctionCreationExpression */:
            case 28 /* ClassDeclaration */:
            case 102 /* InterfaceDeclaration */:
            case 164 /* TraitDeclaration */:
            case 2 /* AnonymousClassDeclaration */:
                return true;
            default:
                return false;
        }
    }
    _isScopeBody(p) {
        switch (p.phraseType) {
            case 86 /* FunctionDeclarationBody */:
            case 113 /* MethodDeclarationBody */:
            case 32 /* ClassMemberDeclarationList */:
            case 105 /* InterfaceMemberDeclarationList */:
            case 167 /* TraitMemberDeclarationList */:
                return true;
            default:
                return false;
        }
    }
    _importFilter(s) {
        return (s.modifiers & 4096 /* Use */) > 0 &&
            (s.kind & (1 /* Class */ | 8 /* Constant */ | 64 /* Function */)) > 0;
    }
    _isNamespaceDefinition(node) {
        return node.phraseType === 119 /* NamespaceDefinition */;
    }
    _isClassDeclaration(node) {
        return node.phraseType === 28 /* ClassDeclaration */;
    }
}
exports.Context = Context;
