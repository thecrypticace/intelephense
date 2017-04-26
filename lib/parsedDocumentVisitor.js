/*
 * Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 *
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const symbol_1 = require("./symbol");
const parsedDocument_1 = require("./parsedDocument");
/**
 * Base class for parsed document visitors.
 * This class comes equipped with a name resolver that will collect namespace definition
 * and use declaration symbols (or come prepopulated with them) for use in resolving fully qualified names
 *
 * Don't return false when visiting namespace definitions and namespace use declarations -- name resolving will be buggy
 *
 * If not descending into children and wishinf to halt make sure to use _containsHaltOffset
 * _preorder still runs on the token containing the haltOffset.
 *
 */
class ParsedDocumentVisitor {
    constructor(document, nameResolver) {
        this.document = document;
        this.nameResolver = nameResolver;
        this.haltTraverse = false;
        this.haltAtOffset = -1;
    }
    preorder(node, spine) {
        switch (node.phraseType) {
            case 119 /* NamespaceDefinition */:
                this.nameResolver.namespace = this._namespaceNamePhraseToString(node.name);
                break;
            case 123 /* NamespaceUseDeclaration */:
                this._namespaceUseDeclarationKind = this._tokenToSymbolKind(node.kind);
                this._namespaceUseDeclarationPrefix = this._namespaceNamePhraseToString(node.prefix);
                break;
            case 121 /* NamespaceUseClause */:
                this.nameResolver.rules.push(this._namespaceUseClause(node, this._namespaceUseDeclarationKind, this._namespaceUseDeclarationPrefix));
                break;
            case 3 /* AnonymousClassDeclarationHeader */:
                this.nameResolver.pushClassName(this._anonymousClassDeclaration(node));
                break;
            case 30 /* ClassDeclarationHeader */:
                this.nameResolver.pushClassName(this._classDeclarationHeader(node));
                break;
            case undefined:
                //tokens
                if (parsedDocument_1.ParsedDocument.isOffsetInToken(this.haltAtOffset, node)) {
                    this.haltTraverse = true;
                }
                break;
            default:
                break;
        }
        return this._preorder(node, spine);
    }
    postorder(node, spine) {
        if (this.haltTraverse) {
            return;
        }
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
        return this._postorder(node, spine);
    }
    _classDeclarationHeader(node) {
        let names = [
            this.nameResolver.resolveRelative(this._namespaceNamePhraseToString(node.name)),
            ''
        ];
        if (node.baseClause) {
            names[1] = this._namePhraseToFqn(node.baseClause.name, 1 /* Class */);
        }
        return names;
    }
    _anonymousClassDeclaration(node) {
        let names = [
            this._createAnonymousName(node),
            ''
        ];
        if (node.header.baseClause) {
            names[1] = this._namePhraseToFqn(node.header.baseClause.name, 1 /* Class */);
        }
        return names;
    }
    _namespaceUseClause(node, kind, prefix) {
        let fqn = this.nameResolver.concatNamespaceName(prefix, this._namespaceNamePhraseToString(node.name));
        if (!kind) {
            kind = 1 /* Class */;
        }
        return {
            kind: kind,
            name: node.aliasingClause ? this._nodeText(node.aliasingClause.alias) : symbol_1.PhpSymbol.notFqn(fqn),
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
    _namespaceUseDeclaration(node) {
        return [this._tokenToSymbolKind(node.kind), this._namespaceNamePhraseToString(node.prefix)];
    }
    _containsHaltOffset(node) {
        return parsedDocument_1.ParsedDocument.isOffsetInNode(this.haltAtOffset, node);
    }
    _nodeText(node, ignore) {
        return this.document.nodeText(node, ignore);
    }
    _nodeRange(node) {
        return this.document.nodeRange(node);
    }
    _nodeLocation(node) {
        return this.document.nodeLocation(node);
    }
    _createAnonymousName(node) {
        return this.document.createAnonymousName(node);
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
        switch (node.phraseType) {
            case 140 /* QualifiedName */:
                return this.nameResolver.resolveNotFullyQualified(this._namespaceNamePhraseToString(node.name), kind);
            case 143 /* RelativeQualifiedName */:
                return this.nameResolver.resolveRelative(this._namespaceNamePhraseToString(node.name));
            case 83 /* FullyQualifiedName */:
                return this._namespaceNamePhraseToString(node.name);
            case 120 /* NamespaceName */:
                return this._namespaceNamePhraseToString(node);
            default:
                return '';
        }
    }
    _namespaceNamePhraseToString(node) {
        if (!parsedDocument_1.ParsedDocument.isPhrase(node, [120 /* NamespaceName */])) {
            return '';
        }
        return this.document.nodeText(node, [159 /* Comment */, 161 /* Whitespace */]);
    }
}
exports.ParsedDocumentVisitor = ParsedDocumentVisitor;
