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
    NamespaceUseClause
} from 'php7parser';
import { TreeTraverser, TreeVisitor } from './types';

/**
 * Base class for parsed document visitors.
 * This class comes equipped with a name resolver that will collect namespace definition
 * and use declaration symbols for use in resolving fully qualified names
 * 
 * Never return false when visiting namespace definitions and namespace use declarations 
 * otherwise name resolution will be incorrect.
 */
export abstract class ParsedDocumentVisitor implements TreeVisitor<Phrase | Token> {

    private _namespaceUseDeclarationKind: SymbolKind;
    private _namespaceUseDeclarationPrefix: string;

    haltTraverse: boolean;

    constructor(
        public nameResolver: NameResolver,
        public haltAtNode?: Phrase | Token
    ) {
        this.haltTraverse = false;
    }

    preorder(node: Phrase | Token, spine: (Phrase | Token)[]) {

        if (this.haltAtNode && this.haltAtNode === node) {
            this.haltTraverse = true;
            return false;
        }

        switch ((<Phrase>node).phraseType) {

            case PhraseType.NamespaceDefinition:
                this.nameResolver.namespaceName = this.nameResolver.namespaceNameNodeText((<NamespaceDefinition>node).name);
                break;

            case PhraseType.NamespaceUseDeclaration:
                this._namespaceUseDeclarationKind = this._tokenToSymbolKind((<NamespaceUseDeclaration>node).kind);
                this._namespaceUseDeclarationPrefix = this.nameResolver.namespaceNameNodeText((<NamespaceUseDeclaration>node).prefix);
                break;

            case PhraseType.NamespaceUseClause:
                this.nameResolver.importedSymbolStubs.push(this._namespaceUseClause(
                    <NamespaceUseClause>node,
                    this._namespaceUseDeclarationKind,
                    this._namespaceUseDeclarationPrefix
                ));
                break;
            default:
                break;
        }

        return this.preorder(node, spine);

    }

    postorder(node: Phrase | Token, spine: (Phrase | Token)[]) {

        if (this.haltTraverse) {
            return;
        }

        switch ((<Phrase>node).phraseType) {
            case PhraseType.NamespaceDefinition:
                if ((<NamespaceDefinition>node).statementList) {
                    this.nameResolver.namespaceName = '';
                }
                break;
            case PhraseType.NamespaceUseDeclaration:
                this._namespaceUseDeclarationKind = 0;
                this._namespaceUseDeclarationPrefix = '';
                break;
            default:
                break;
        }

        return this._postorder(node, spine);

    }

    private _namespaceUseClause(node: NamespaceUseClause, kind: SymbolKind, prefix: string) {

        let fqn = this.nameResolver.concatNamespaceName(prefix, this.nameResolver.namespaceNameNodeText(node.name));

        if (!kind) {
            kind = SymbolKind.Class;
        }

        return <PhpSymbol>{
            kind: kind,
            name: node.aliasingClause ? this.nameResolver.nodeText(node.aliasingClause.alias) : PhpSymbol.notFqn(fqn),
            associated: [{ kind: kind, name: fqn }]
        };

    }

    private _tokenToSymbolKind(t: Token) {

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

    private _namespaceUseDeclaration(node: NamespaceUseDeclaration): [SymbolKind, string] {
        return [this._tokenToSymbolKind(node.kind), this.nameResolver.namespaceNameNodeText(node.prefix)];
    }

    protected abstract _preorder(node: Phrase | Token, spine: (Phrase | Token)[]): boolean;
    protected abstract _postorder(node: Phrase | Token, spine: (Phrase | Token)[]): void;


}