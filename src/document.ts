/* Copyright © Ben Mewburn ben@mewburn.id.au
 * Licensed under the MIT Licence.
 */

'use strict';

import { Position, Range, BinarySearch } from './types';
import { Phrase, Token } from 'php7parser';

export class TextDocument {

    private _uri: string;
    private _text: string;
    private _lineOffsets: number[];

    constructor(uri: string, fullText: string) {
        this._uri = uri;
        this._text = fullText;
        this._lineOffsets = this._textLineOffsets(fullText, 0);
    }

    get uri() {
        return this._uri;
    }

    get fullText() {
        return this._text;
    }

    get lineOffsets() {
        return this._lineOffsets;
    }

    textAtOffset(offset: number, length: number) {
        return this._text.substr(offset, length);
    }

    positionAtOffset(offset: number) {

        let search = new BinarySearch<number>(this._lineOffsets);
        let rank = search.rank((x) => {
            return offset - x;
        });
        let index = Math.max(rank - 1, 0);


        if (rank < this._lineOffsets.length) {

        } else {
            return
        }

    }

    offsetAtPosition(pos: Position) {

        if (pos.line >= this._lineOffsets.length) {
            return this._text.length;
        } else if (pos.line < 0) {
            return 0;
        }

        return this._lineOffsets[pos.line] + pos.character;

    }

    applyEdit(start: Position, end: Position, text: string) {

        let startOffset = this.offsetAtPosition(start);
        let endOffset = this.offsetAtPosition(end);
        this._text = this._text.slice(0, startOffset) + text + this._text.slice(endOffset + 1);
        let newLineOffsets = this._lineOffsets.slice(0, start.line + 1);
        Array.prototype.push.apply(newLineOffsets, this._textLineOffsets(text, startOffset).slice(1));
        Array.prototype.push.apply(newLineOffsets, this._lineOffsets.slice(end.line + 1));
        this._lineOffsets = newLineOffsets;
        let lengthDiff = text.length - (endOffset - startOffset);

        for (let n = end.line + 1; n < this._lineOffsets.length; ++n) {
            this._lineOffsets[n] += lengthDiff;
        }

    }

    private _textLineOffsets(text: string, offset: number) {

        let n = 0;
        let length = text.length;
        let isLineStart = true;
        let offsets = [];
        let c: string;

        while (n < length) {

            c = text[n];

            if (isLineStart) {
                offsets.push(n + offset);
                isLineStart = false;
            }

            if (c === '\r') {
                if (++n < length && text[n] === '\n') {
                    ++n;
                }
                isLineStart = true;
                continue;
            } else if (c === '\n') {
                isLineStart = true;
            }

            ++n;

        }

        return offsets;

    }

}

export interface TextDocumentChange {
    range: Range;
    rangeLength: number;
    text: string;
}


export class ParseTree {

    private _textDocument: TextDocument;

    constructor(textDocument: TextDocument) {
        this._textDocument = textDocument;
    }

    get textDocument() {
        return this._textDocument;
    }

    applyEdits(changes: TextDocumentChange[]) {

        changes.sort(this._compareChanges);
        let changeStartOffset: number, changeEndOffset: number;

        for (let n = 0; n < changes.length; ++n) {

            changeStartOffset = this._textDocument.offsetAtPosition(changes[n].range.start);
            changeEndOffset = this._textDocument.offsetAtPosition(changes[n].range.end);



        }

    }

    private _compareChanges = (a: TextDocumentChange, b: TextDocumentChange) => {

        if (a.range.end.line > b.range.end.line) {
            return -1;
        } else if (a.range.end.line < b.range.end.line) {
            return 1;
        } else {
            return b.range.end.character - a.range.end.character;
        }

    }

}

export namespace ParseTree {

    export function tokenRange(node: Phrase | Token): [Token, Token] {
        return [firstToken(node), lastToken(node)];
    }

    export function firstToken(node: Phrase | Token) {

        if ((<Token>node).tokenType !== undefined) {
            return node as Token;
        }

        let t: Token;
        for (let n = 0, l = (<Phrase>node).children.length; n < l; ++n) {
            t = firstToken((<Phrase>node).children[n]);
            if (t !== null) {
                return t;
            }
        }

        return null;
    }

    export function lastToken(node: Phrase | Token) {
        if ((<Token>node).tokenType !== undefined) {
            return node as Token;
        }

        let t: Token;
        for (let n = (<Phrase>node).children.length - 1; n >= 0; --n) {
            t = lastToken((<Phrase>node).children[n]);
            if (t !== null) {
                return t;
            }
        }

        return null;
    }

}

interface DocumentMap {
    [uri: string]: TextDocument
}

export interface DocumentChangeEvent {
    document: TextDocument
}

export class DocumentStore {

    private _documents: DocumentMap;

    constructor() {
        this._documents = {};
    }

    add(doc: TextDocument) {
        this._documents[doc.uri] = doc;
    }

    remove(uri: string) {
        delete this._documents[uri];
    }

    find(uri: string) {
        return this._documents[uri] ? this._documents[uri] : null;
    }

}