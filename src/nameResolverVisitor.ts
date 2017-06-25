/* 
 * Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 * 
 */

'use strict';

import * as lsp from 'vscode-languageserver-types';
import { PhpSymbol, SymbolKind } from './symbol';
import { NameResolver } from './nameResolver';
import { ParsedDocument, ParsedDocumentStore } from './parsedDocument';
import { Context } from './context';
import {
    Phrase, PhraseType, Token, TokenType, NamespaceDefinition, NamespaceUseDeclaration,
    NamespaceUseClause, QualifiedName, FullyQualifiedName, RelativeQualifiedName,
    NamespaceName, ClassDeclarationHeader, AnonymousClassDeclarationHeader,
    AnonymousClassDeclaration
} from 'php7parser';
import { TreeTraverser, TreeVisitor } from './types';

export class NameResolverVisitor implements TreeVisitor<Phrase | Token> {

    private _namespaceUseDeclarationKind: SymbolKind;
    private _namespaceUseDeclarationPrefix: string;

    constructor(
        public document: ParsedDocument,
        public nameResolver: NameResolver
    ) {
    }

    preorder(node: Phrase | Token, spine: (Phrase | Token)[]) {

        let parent = spine.length ? <Phrase>spine[spine.length - 1] : <Phrase>{phraseType:PhraseType.Unknown, children:[]};

        switch ((<Phrase>node).phraseType) {

            case PhraseType.NamespaceDefinition:
                this.nameResolver.namespace = this.document.nodeText((<NamespaceDefinition>node).name);
                break;

            case PhraseType.NamespaceUseDeclaration:
                this._namespaceUseDeclarationKind = this._tokenToSymbolKind((<NamespaceUseDeclaration>node).kind);
                this._namespaceUseDeclarationPrefix = this.document.nodeText((<NamespaceUseDeclaration>node).prefix);
                break;

            case PhraseType.NamespaceUseClause:
                this.nameResolver.rules.push(this._namespaceUseClause(
                    <NamespaceUseClause>node,
                    this._namespaceUseDeclarationKind,
                    this._namespaceUseDeclarationPrefix
                ));
                break;

            case PhraseType.AnonymousClassDeclarationHeader:
                this.nameResolver.pushClassName(this._anonymousClassDeclarationHeader(<AnonymousClassDeclarationHeader>node,  parent));
                break;

            case PhraseType.ClassDeclarationHeader:
                this.nameResolver.pushClassName(this._classDeclarationHeader(<ClassDeclarationHeader>node));
                break;

            default:
                break;
        }

        return true;

    }

    postorder(node: Phrase | Token, spine: (Phrase | Token)[]) {

        switch ((<Phrase>node).phraseType) {
            case PhraseType.NamespaceDefinition:
                if ((<NamespaceDefinition>node).statementList) {
                    this.nameResolver.namespace = '';
                }
                break;

            case PhraseType.NamespaceUseDeclaration:
                this._namespaceUseDeclarationKind = 0;
                this._namespaceUseDeclarationPrefix = '';
                break;

            case PhraseType.ClassDeclaration:
            case PhraseType.AnonymousClassDeclaration:
                this.nameResolver.popClassName();
                break;

            default:
                break;
        }

    }

    private _classDeclarationHeader(node: ClassDeclarationHeader) {
        let names: [string, string] = [
            this.nameResolver.resolveRelative(this.document.tokenText(node.name)),
            ''
        ];

        if (node.baseClause) {
            names[1] = this._namePhraseToFqn(node.baseClause.name, SymbolKind.Class);
        }

        return names;
    }

    private _anonymousClassDeclarationHeader(node: AnonymousClassDeclarationHeader, parent:Phrase) {
        let names: [string, string] = [
            this.document.createAnonymousName(parent),
            ''
        ];

        if (node.baseClause) {
            names[1] = this._namePhraseToFqn(node.baseClause.name, SymbolKind.Class);
        }

        return names;
    }

    private _namespaceUseClause(node: NamespaceUseClause, kind: SymbolKind, prefix: string) {

        let fqn = this.nameResolver.concatNamespaceName(prefix, this.document.nodeText(node.name));

        if (!kind) {
            kind = SymbolKind.Class;
        }

        return <PhpSymbol>{
            kind: kind,
            name: node.aliasingClause ? this.document.nodeText(node.aliasingClause.alias) : PhpSymbol.notFqn(fqn),
            associated: [{ kind: kind, name: fqn }]
        };

    }

    protected _tokenToSymbolKind(t: Token) {

        if (!t) {
            return SymbolKind.None;
        }

        switch (t.tokenType) {
            case TokenType.Function:
                return SymbolKind.Function;
            case TokenType.Const:
                return SymbolKind.Constant;
            default:
                return SymbolKind.None;
        }
    }

    /**
     * Resolves name node to FQN
     * @param node 
     * @param kind needed to resolve qualified names against import rules
     */
    protected _namePhraseToFqn(node: Phrase, kind: SymbolKind) {
        if (!node) {
            return '';
        }

        let text = this.document.nodeText((<QualifiedName>node).name, [TokenType.Comment, TokenType.Whitespace]);

        switch (node.phraseType) {
            case PhraseType.QualifiedName:
                return this.nameResolver.resolveNotFullyQualified(text, kind);
            case PhraseType.RelativeQualifiedName:
                return this.nameResolver.resolveRelative(text);
            case PhraseType.FullyQualifiedName:
                return text;
            default:
                return '';
        }
    }

}