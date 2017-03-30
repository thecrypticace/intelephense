/* Copyright (c) Ben Mewburn ben@mewburn.id.au
 * Licensed under the MIT Licence.
 */

'use strict';

import { Phrase, Token, NamespaceName, MemberName, TokenType } from 'php7parser';
import { TextDocument } from './document';

export class ParseTree {

    constructor(
        public uri: string,
        public root: Phrase
    ) { }

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

    export function tokenToString(t: Token, textDocument:TextDocument){
        return isToken(t) ? textDocument.textAtOffset(t.offset, t.length) : '';
    }

    export function namespaceNameToString(node: NamespaceName, textDocument:TextDocument) {

        if (!node || !node.parts || node.parts.length < 1) {
            return '';
        }

        let parts: string[] = [];
        for (let n = 0, l = node.parts.length; n < l; ++n) {
            parts.push(ParseTree.tokenToString(node.parts[n], textDocument));
        }

        return parts.join('\\');

    }

    export function isToken(node:Phrase | Token, type?:TokenType){
        return node && (<Token>node).tokenType !== undefined && (!type || type === (<Token>node).tokenType);
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