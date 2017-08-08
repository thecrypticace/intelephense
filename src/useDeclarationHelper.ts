/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */

'use strict';

import {ParsedDocument} from './parsedDocument';
import {SymbolTable} from './symbolStore';
import {PhpSymbol, SymbolKind, SymbolModifier } from './symbol';
import {Position} from 'vscode-languageserver-types';
import {TreeVisitor} from './types';
import {Phrase, Token, PhraseType, TokenType} from 'php7parser';

export class UseDeclarationHelper {

    private _useDeclarations:PhpSymbol[];

    constructor(public doc:ParsedDocument, public table:SymbolTable) { 
        this._useDeclarations = table.filter(this._isUseDeclarationSymbol);
    }

    insertPosition(current:Position) {
        let visitor = new InsertPositionVisitor(this.doc, this.doc.offsetAtPosition(current));
        this.doc.traverse(visitor);
        return visitor.lastNamespaceUseDeclaration || visitor.namespaceDefinition || visitor.openingInlineText;
    }

    declarationRange(fqn:string) {

    }

    isImported(fqn:string) {
        let lcFqn = fqn.toLowerCase();
        let fn = (x:PhpSymbol) => {
            return x.associated && x.associated.length > 0 && x.associated[0].name.toLowerCase() === lcFqn;
        }
        return this._useDeclarations.find(fn) !== undefined;
    }

    nameExists(name:string) {

        let lcName = name.toLowerCase();
        let fn = (x:PhpSymbol) => {
            return x.name.toLowerCase() === lcName;
        }

        return this._useDeclarations.find(fn) !== undefined;

    }

    private _isUseDeclarationSymbol(s:PhpSymbol) {
        const mask = SymbolKind.Class | SymbolKind.Function | SymbolKind.Constant;
        return (s.modifiers & SymbolModifier.Use) > 0 && (s.kind & mask) > 0;
    }


}

class InsertPositionVisitor implements TreeVisitor<Phrase | Token> {

    private _openingInlineText: Phrase;
    private _lastNamespaceUseDeclaration: Phrase;
    private _namespaceDefinition: Phrase;

    haltTraverse = false;
    haltAtOffset = -1;

    constructor(
        public document: ParsedDocument,
        offset: number) {
        this.haltAtOffset = offset;
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

    preorder(node: Phrase | Token, spine: (Phrase | Token)[]) {

        switch ((<Phrase>node).phraseType) {
            case PhraseType.InlineText:
                if (!this._openingInlineText) {
                    this._openingInlineText = node as Phrase;
                }
                break;

            case PhraseType.NamespaceDefinition:
                if(!ParsedDocument.findChild(<Phrase>node, this._isStatementList)) {
                    this._namespaceDefinition = node as Phrase;
                }
                break;

            case PhraseType.NamespaceUseDeclaration:
                this._lastNamespaceUseDeclaration = node as Phrase;
                break;

            case undefined:
                //tokens
                if (this.haltAtOffset > -1 && ParsedDocument.isOffsetInToken(this.haltAtOffset, <Token>node)) {
                    this.haltTraverse = true;
                    return false;
                }
                break;

            default:
                break;

        }

        return true;

    }

    private _isStatementList(node:Phrase|Token) {
        return (<Phrase>node).phraseType === PhraseType.StatementList;
    }

}