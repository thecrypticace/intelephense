/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const typeResolver_1 = require("./typeResolver");
const nameResolver_1 = require("./nameResolver");
const types_1 = require("./types");
const parsedDocument_1 = require("./parsedDocument");
const nameResolverVisitor_1 = require("./nameResolverVisitor");
class ContextResolver extends types_1.MultiVisitor {
    constructor(nameResolverVisitor, contextVisitor) {
        super([nameResolverVisitor, contextVisitor]);
        this._nameResolverVisitor = nameResolverVisitor;
        this._contextVisitor = contextVisitor;
    }
    get nameResolver() {
        return this._nameResolverVisitor.nameResolver;
    }
    get spine() {
        return this._contextVisitor.spine;
    }
    get openingInlineText() {
        return this._contextVisitor.openingInlineText;
    }
    get lastNamespaceUseDeclaration() {
        return this._contextVisitor.lastNamespaceUseDeclaration;
    }
    get namespaceDefinition() {
        return this._contextVisitor.namespaceDefinition;
    }
    static create(document, nameResolver, offset) {
        return new ContextResolver(new nameResolverVisitor_1.NameResolverVisitor(document, nameResolver), new ContextVisitor(document, nameResolver, offset));
    }
}
class ContextVisitor {
    constructor(document, nameResolver, offset) {
        this.document = document;
        this.nameResolver = nameResolver;
        this.haltTraverse = false;
        this.haltAtOffset = -1;
        this.haltAtOffset = offset;
    }
    get spine() {
        return this._spine.slice(0);
    }
    get openingInlineText() {
        return this._openingInlineText;
    }
    get lastNamespaceUseDeclaration() {
        return this._lastNamespaceUseDeclaration;
    }
    get namespaceDefinition() {
        return this._namespaceDefinition;
    }
    preorder(node, spine) {
        switch (node.phraseType) {
            case 98 /* InlineText */:
                if (!this._openingInlineText) {
                    this._openingInlineText = node;
                }
                break;
            case 119 /* NamespaceDefinition */:
                this._namespaceDefinition = node;
                break;
            case 123 /* NamespaceUseDeclaration */:
                this._lastNamespaceUseDeclaration = node;
                break;
            case undefined:
                //tokens
                if (this.haltAtOffset > -1 && parsedDocument_1.ParsedDocument.isOffsetInToken(this.haltAtOffset, node)) {
                    this.haltTraverse = true;
                    this._spine = spine.slice(0);
                    this._spine.push(node);
                    return false;
                }
        }
        return true;
    }
    postorder(node, spine) {
        if (this.haltTraverse) {
            return;
        }
        switch (node.phraseType) {
            case 119 /* NamespaceDefinition */:
                if (node.statementList) {
                    this._namespaceDefinition = null;
                }
                break;
            default:
                break;
        }
    }
}
class Context {
    constructor(symbolStore, document, position) {
        this.symbolStore = symbolStore;
        this.document = document;
        this.position = position;
        this._offset = document.offsetAtPosition(position) - 1;
        let contextVisitor = ContextResolver.create(this.document, new nameResolver_1.NameResolver(), this._offset);
        document.traverse(contextVisitor);
        this._parseTreeSpine = contextVisitor.spine;
        this._openingInlineText = contextVisitor.openingInlineText;
        this._nameResolver = contextVisitor.nameResolver;
        this._lastNamespaceUseDeclaration = contextVisitor.lastNamespaceUseDeclaration;
        this._namespaceDefinition = contextVisitor.namespaceDefinition;
    }
    get uri() {
        return this.document.uri;
    }
    get word() {
        return this.document.wordAtOffset(this._offset);
    }
    get wordStartPosition() {
        if (this._wordStartPosition === undefined) {
            let startOffset = this._offset - (this.word.length - 1);
            this._wordStartPosition = this.document.positionAtOffset(startOffset);
        }
        return this._wordStartPosition;
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
    get className() {
        return this._nameResolver.className;
    }
    get classBaseName() {
        return this._nameResolver.classBaseName;
    }
    get namespace() {
        return this._nameResolver.namespace;
    }
    get lastNamespaceUseDeclaration() {
        return this._lastNamespaceUseDeclaration;
    }
    get namespaceDefinition() {
        return this._namespaceDefinition;
    }
    get openingInlineText() {
        return this._openingInlineText;
    }
    get classDeclarationPhrase() {
        if (this._thisPhrase === undefined) {
            let traverser = this.createTraverser();
            this._thisPhrase = traverser.ancestor(this._isClassDeclaration);
        }
        return this._thisPhrase;
    }
    get classSymbol() {
        if (this._thisSymbol === undefined) {
            let phrase = this.classDeclarationPhrase;
            if (phrase) {
                let symbolTable = this.symbolStore.getSymbolTable(this.document.uri);
                let phrasePos = this.document.nodeRange(phrase).start;
                this._thisSymbol = symbolTable.symbolAtPosition(phrasePos);
            }
            else {
                this._thisSymbol = null;
            }
        }
        return this._thisSymbol;
    }
    get classBaseSymbol() {
        if (this._thisBaseSymbol === undefined) {
            let thisSymbol = this.classSymbol;
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
            let phrasePos = this.document.nodeRange(phrase).start;
            this._scopeSymbol = symbolTable.symbolAtPosition(phrasePos);
            if (!this._scopeSymbol) {
                this._scopeSymbol = symbolTable.root;
            }
        }
        return this._scopeSymbol;
    }
    get variableTable() {
        if (!this._variableTable) {
            let varTypeResolver = typeResolver_1.VariableTypeResolver.create(this.document, this.nameResolver, this.symbolStore, new typeResolver_1.VariableTable());
            varTypeResolver.haltAtOffset = this.token.offset;
            let t = this.createTraverser();
            let scope = t.ancestor(this._isAbsoluteScopePhrase);
            if (!scope) {
                scope = this._parseTreeSpine[0];
            }
            let traverser = new types_1.TreeTraverser([scope]);
            traverser.traverse(varTypeResolver);
            this._variableTable = varTypeResolver.variableTable;
        }
        return this._variableTable;
    }
    get symbolTable() {
        return this.symbolStore.getSymbolTable(this.document.uri);
    }
    get nameResolver() {
        return this._nameResolver;
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
        if (!phrase) {
            return '';
        }
        switch (phrase.phraseType) {
            case 140 /* QualifiedName */:
                return this.nameResolver.resolveNotFullyQualified(this.document.namespaceNamePhraseToString(phrase.name), kind);
            case 143 /* RelativeQualifiedName */:
                return this.nameResolver.resolveRelative(this.document.namespaceNamePhraseToString(phrase.name));
            case 83 /* FullyQualifiedName */:
                return this.document.namespaceNamePhraseToString(phrase.name);
            case 120 /* NamespaceName */:
                return this.document.namespaceNamePhraseToString(phrase);
            default:
                return '';
        }
    }
    resolveExpressionType(expr) {
        let exprResolver = this.createExpressionTypeResolver();
        return exprResolver.resolveExpression(expr);
    }
    createTraverser() {
        return new types_1.TreeTraverser(this._parseTreeSpine);
    }
    createExpressionTypeResolver() {
        return new typeResolver_1.ExpressionTypeResolver(this.document, this._nameResolver, this.symbolStore, this.variableTable);
    }
    _isAbsoluteScopePhrase(p) {
        switch (p.phraseType) {
            case 85 /* FunctionDeclaration */:
            case 112 /* MethodDeclaration */:
            case 28 /* ClassDeclaration */:
            case 102 /* InterfaceDeclaration */:
            case 164 /* TraitDeclaration */:
            case 2 /* AnonymousClassDeclaration */:
                return true;
            default:
                return false;
        }
    }
    _isScopePhrase(p) {
        switch (p.phraseType) {
            case 85 /* FunctionDeclaration */:
            case 112 /* MethodDeclaration */:
            case 28 /* ClassDeclaration */:
            case 4 /* AnonymousFunctionCreationExpression */:
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
