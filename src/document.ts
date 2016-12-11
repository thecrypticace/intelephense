/* Copyright © Ben Mewburn ben@mewburn.id.au
 * Licensed under the MIT Licence.
 */

'use strict';

export class Document {

    private _uri: string;
    private _lines: string[];
    private _newlinePattern = /\r\n|\r|\n/;

    constructor(uri: string, fullText: string) {
        this._uri = uri;
        this._lines = fullText.split(this._newlinePattern);
    }

    get uri() {
        return this._uri;
    }

    get text() {
        return this._lines.join('\n');
    }

    line(n: number) {
        return n < this._lines.length ? this._lines[n] : null;
    }

    chunk(startLine: number, startChar: number, endLine: number, endChar: number) {
        let chunk = this._lines.slice(startLine, endLine + 1);
        chunk[0] = chunk[0].slice(startChar);
        chunk[chunk.length - 1].slice(0, endChar + 1);
        return chunk.join('\n');
    }

    edit(startLine: number, startChar: number, endLine: number, endChar: number, text: string) {

        let startLines = this._lines.slice(0, startLine);
        let endLines = this._lines.slice(endLine + 1);
        let textArray = text.split(this._newlinePattern);
        textArray[0] = this._lines[startLine].slice(0, startChar) + textArray[0];
        textArray[textArray.length - 1] += this._lines[endLine].slice(endChar);
        this._lines = startLines;
        Array.prototype.push.apply(this._lines, textArray);
        Array.prototype.push.apply(this._lines, endLines);

    }

}

interface DocumentMap {
    [uri: string]: Document
}

export interface DocumentChangeEvent {
    document: Document
}

export class DocumentStore {

    private _documents: DocumentMap;

    constructor() {
        this._documents = {};
    }

    add(doc:Document){
        this._documents[doc.uri] = doc;
    }

    remove(uri:string){
        delete this._documents[uri];
    }

    find(uri: string) {
        return this._documents[uri] ? this._documents[uri] : null;
    }

}