/*
 * Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 *
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const symbol_1 = require("./symbol");
class NameResolverVisitor {
    constructor(document, nameResolver) {
        this.document = document;
        this.nameResolver = nameResolver;
    }
    preorder(node, spine) {
        let parent = spine.length ? spine[spine.length - 1] : { phraseType: 0 /* Unknown */, children: [] };
        switch (node.phraseType) {
            case 119 /* NamespaceDefinition */:
                this.nameResolver.namespace = this.document.nodeText(node.name);
                break;
            case 123 /* NamespaceUseDeclaration */:
                this._namespaceUseDeclarationKind = this._tokenToSymbolKind(node.kind);
                this._namespaceUseDeclarationPrefix = this.document.nodeText(node.prefix);
                break;
            case 121 /* NamespaceUseClause */:
                this.nameResolver.rules.push(this._namespaceUseClause(node, this._namespaceUseDeclarationKind, this._namespaceUseDeclarationPrefix));
                break;
            case 3 /* AnonymousClassDeclarationHeader */:
                this.nameResolver.pushClassName(this._anonymousClassDeclarationHeader(node, parent));
                break;
            case 30 /* ClassDeclarationHeader */:
                this.nameResolver.pushClassName(this._classDeclarationHeader(node));
                break;
            default:
                break;
        }
        return true;
    }
    postorder(node, spine) {
        switch (node.phraseType) {
            case 119 /* NamespaceDefinition */:
                if (node.statementList) {
                    this.nameResolver.namespace = '';
                }
                break;
            case 123 /* NamespaceUseDeclaration */:
                this._namespaceUseDeclarationKind = 0;
                this._namespaceUseDeclarationPrefix = '';
                break;
            case 28 /* ClassDeclaration */:
            case 2 /* AnonymousClassDeclaration */:
                this.nameResolver.popClassName();
                break;
            default:
                break;
        }
    }
    _classDeclarationHeader(node) {
        let names = [
            this.nameResolver.resolveRelative(this.document.tokenText(node.name)),
            ''
        ];
        if (node.baseClause) {
            names[1] = this._namePhraseToFqn(node.baseClause.name, 1 /* Class */);
        }
        return names;
    }
    _anonymousClassDeclarationHeader(node, parent) {
        let names = [
            this.document.createAnonymousName(parent),
            ''
        ];
        if (node.baseClause) {
            names[1] = this._namePhraseToFqn(node.baseClause.name, 1 /* Class */);
        }
        return names;
    }
    _namespaceUseClause(node, kind, prefix) {
        let fqn = this.nameResolver.concatNamespaceName(prefix, this.document.nodeText(node.name));
        if (!kind) {
            kind = 1 /* Class */;
        }
        return {
            kind: kind,
            name: node.aliasingClause ? this.document.nodeText(node.aliasingClause.alias) : symbol_1.PhpSymbol.notFqn(fqn),
            associated: [{ kind: kind, name: fqn }]
        };
    }
    _tokenToSymbolKind(t) {
        if (!t) {
            return 0 /* None */;
        }
        switch (t.tokenType) {
            case 35 /* Function */:
                return 64 /* Function */;
            case 12 /* Const */:
                return 8 /* Constant */;
            default:
                return 0 /* None */;
        }
    }
    /**
     * Resolves name node to FQN
     * @param node
     * @param kind needed to resolve qualified names against import rules
     */
    _namePhraseToFqn(node, kind) {
        if (!node) {
            return '';
        }
        let text = this.document.nodeText(node.name, [159 /* Comment */, 161 /* Whitespace */]);
        switch (node.phraseType) {
            case 140 /* QualifiedName */:
                return this.nameResolver.resolveNotFullyQualified(text, kind);
            case 143 /* RelativeQualifiedName */:
                return this.nameResolver.resolveRelative(text);
            case 83 /* FullyQualifiedName */:
                return text;
            default:
                return '';
        }
    }
}
exports.NameResolverVisitor = NameResolverVisitor;
