/* Copyright (c) Ben Mewburn ben@mewburn.id.au
 * Licensed under the MIT Licence.
 */

'use strict';

import { Phrase, Token, NamespaceName, MemberName, TokenType, PhraseType } from 'php7parser';
import { TextDocument } from './document';
import { Range } from 'vscode-languageserver-types';

export class ParseTree {

    constructor(
        public uri: string,
        public root: Phrase
    ) { }

}

export namespace ParseTree {

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

    export function tokenToString(t: Token, textDocument: TextDocument) {
        return isToken(t) ? textDocument.textAtOffset(t.offset, t.length) : '';
    }

    export function namespaceNameToString(node: NamespaceName, textDocument: TextDocument) {

        if (!node || !node.parts || node.parts.length < 1) {
            return '';
        }

        let parts: string[] = [];
        for (let n = 0, l = node.parts.length; n < l; ++n) {
            parts.push(ParseTree.tokenToString(node.parts[n], textDocument));
        }

        return parts.join('\\');

    }

    export function isToken(node: Phrase | Token, type?: TokenType) {
        return node && (<Token>node).tokenType !== undefined && (!type || type === (<Token>node).tokenType);
    }

    export function anonymousName(node: Phrase, textDocument: TextDocument) {
        let range = phraseRange(node, textDocument);
        let suffix = [range.start.line, range.start.character, range.end.line, range.end.character].join('#');
        return '#anonymous#' + suffix;
    }

    export function phraseRange(p: Phrase, textDocument: TextDocument) {
        let tFirst = firstToken(p);
        let tLast = lastToken(p);

        if (!tFirst || !tLast) {
            return null;
        }

        return <Range>{
            start: textDocument.positionAtOffset(tFirst.offset),
            end: textDocument.positionAtOffset(tLast.offset + tLast.length)
        }

    }

    export function isNamePhrase(p: Phrase) {
        switch (p.phraseType) {
            case PhraseType.RelativeQualifiedName:
            case PhraseType.QualifiedName:
            case PhraseType.FullyQualifiedName:
                return true;
            default:
                return false;
        }
    }


}

export class ParseTreeStore {

    private _map: { [index: string]: ParseTree };

    constructor() {
        this._map = {};
    }

    add(parseTree: ParseTree) {
        this._map[parseTree.uri] = parseTree;
    }

    remove(uri: string) {
        delete this._map[uri];
    }

    getParsedDocument(uri: string) {
        return this._map[uri];
    }

}