/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */

'use strict';

import {ParsedDocument} from './parsedDocument';
import {SymbolTable} from './symbolStore';
import {PhpSymbol, SymbolKind, SymbolModifier } from './symbol';
import {Position, TextEdit} from 'vscode-languageserver-types';
import {TreeVisitor} from './types';
import {Phrase, Token, PhraseType, TokenType} from 'php7parser';

export class UseDeclarationHelper {

    private _useDeclarations:PhpSymbol[];
    private _afterNode:Phrase;
    private _afterNodeEndPosition:Position;
    private _cursor:Position;

    constructor(public doc:ParsedDocument, public table:SymbolTable, cursor:Position) { 
        this._useDeclarations = table.filter(this._isUseDeclarationSymbol);
        this._cursor = cursor;
    }

    insertDeclarationTextEdit(symbol:PhpSymbol, alias?:string) {
        let afterNode = this._insertAfterNode();

        let text = '\n';
        if(afterNode.phraseType === PhraseType.NamespaceDefinition){
            text += '\n';
        }

        text += 'use ';

        switch(symbol.kind) {
            case SymbolKind.Constant:
                text += 'const ';
                break;
            case SymbolKind.Function:
                text += 'function ';
                break;
            default:
                break;
        }

        text += symbol.name;

        if(alias) {
            text += ' as ' + alias;
        }

        text += ';';

        return TextEdit.insert(this._insertPosition(), text);

    }

    deleteDeclarationTextEdit(fqn:string) {

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

    private _insertAfterNode() {

        if(this._afterNode) {
            return this._afterNode;
        }

        let visitor = new InsertAfterNodeVisitor(this.doc, this.doc.offsetAtPosition(this._cursor));
        this.doc.traverse(visitor);
        return this._afterNode = visitor.lastNamespaceUseDeclaration || visitor.namespaceDefinition || visitor.openingInlineText;
    }

    private _insertPosition() {
        if(this._afterNodeEndPosition) {
            return this._afterNodeEndPosition;
        }

        return this._afterNodeEndPosition = this.doc.nodeRange(this._insertAfterNode()).end;
    }

}

class InsertAfterNodeVisitor implements TreeVisitor<Phrase | Token> {

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