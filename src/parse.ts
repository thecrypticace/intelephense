/* Copyright © Ben Mewburn ben@mewburn.id.au
 * Licensed under the MIT Licence.
 */

'use strict';

import {Tree} from './types';
import {Token, AstNode} from 'php7parser';

export class ParsedDocument {

    private _tokens:Token[];
    private _parseTree:ParseTree;

    constructor(tokens:Token[], parseTree:ParseTree){
        this._tokens = tokens;
        this._parseTree = parseTree;
    }

    get tokens(){
        return this._tokens;
    }

    get parseTree(){
        return this._parseTree;
    }
}

export class ParseTree extends Tree<AstNode|Token> {

}