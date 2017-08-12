/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */

'use strict';

import { PhpSymbol, SymbolKind, SymbolModifier, Reference } from './symbol';
import { SymbolStore, SymbolTable } from './symbolStore';
import { NameResolver } from './nameResolver';
import { TreeVisitor, TreeTraverser, Predicate, MultiVisitor } from './types';
import { TypeString } from './typeString';
import { ParsedDocument } from './parsedDocument';
import { NameResolverVisitor } from './nameResolverVisitor';
import { Position, TextEdit, Range } from 'vscode-languageserver-types';
import { Phrase, Token, PhraseType, TokenType, } from 'php7parser';
import * as util from './util';

export class ParseTreeTraverser extends TreeTraverser<Phrase | Token> {

    private _doc: ParsedDocument;
    private _table: SymbolTable;

    constructor(document: ParsedDocument, symbolTable: SymbolTable) {
        super([document.tree]);
        this._doc = document;
        this._table = symbolTable;
    }

    get document() {
        return this._doc;
    }

    get symbolTable() {
        return this._table;
    }

    get text() {
        return this._doc.nodeText(this.node);
    }

    get range() {
        return this._doc.nodeRange(this.node);
    }

    get reference() {
        let scope = this.scope;
        let range = this.range;

        if (!scope || !range || !scope.references) {
            return null;
        }

        let ref: Reference;
        for (let n = 0; n < scope.references.length; ++n) {
            ref = scope.references[n];
            if (util.isInRange(range.start, ref.location.range) === 0) {
                return ref;
            }
        }

        return null;
    }

    get scope() {
        let range = this.range;
        if (!range) {
            return null;
        }
        return this._table.scope(range.start);
    }

    get nameResolver() {
        let firstToken = ParsedDocument.firstToken(this.node);
        let pos = this.document.positionAtOffset(firstToken.offset);
        return this._table.nameResolver(pos);
    }

    position(pos: Position) {
        let offset = this._doc.offsetAtPosition(pos);
        let fn = (x: Phrase | Token) => {
            return (<Token>x).tokenType !== undefined &&
                offset < (<Token>x).offset + (<Token>x).length &&
                offset >= (<Token>x).offset;
        };

        return this.find(fn) as Token;
    }

    clone() {
        let spine = this.spine;
        let traverser = new ParseTreeTraverser(this._doc, this._table);
        traverser._spine = spine;
        return traverser;
    }

    /**
     * True if current node is the name part of a declaration
     */
    get isDeclarationName() {

        let traverser = this.clone();
        let t = traverser.node as Token;
        let parent = traverser.parent() as Phrase;

        if (!t || !parent) {
            return false;
        }

        return ((t.tokenType === TokenType.Name || t.tokenType === TokenType.VariableName) && this._isDeclarationPhrase(parent)) ||
            (parent.phraseType === PhraseType.Identifier && this._isDeclarationPhrase(<Phrase>traverser.parent()));

    }

    private _isDeclarationPhrase(node: Phrase) {

        if (!node) {
            return false;
        }

        switch (node.phraseType) {
            case PhraseType.ClassDeclarationHeader:
            case PhraseType.TraitDeclarationHeader:
            case PhraseType.InterfaceDeclarationHeader:
            case PhraseType.PropertyElement:
            case PhraseType.ConstElement:
            case PhraseType.ParameterDeclaration:
            case PhraseType.FunctionDeclarationHeader:
            case PhraseType.MethodDeclarationHeader:
            case PhraseType.ClassConstElement:
                return true;
            default:
                return false;
        }
    }

}
