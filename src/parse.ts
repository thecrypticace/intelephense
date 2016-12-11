/* Copyright © Ben Mewburn ben@mewburn.id.au
 * Licensed under the MIT Licence.
 */

'use strict';

import {Tree} from './types';
import {Token, AstNode, AstNodeFactory} from 'php7parser';

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

    private _uri;

    constructor(uri){
        super(null);
        this._uri = uri;
    }

    get uri(){
        return this._uri;
    }
}

export var astNodeFactory:AstNodeFactory<Tree<AstNode|Token>> = function(value, children){
    let tree = new Tree<AstNode|Token>(value);
    tree.addChildren(children);
    return tree;
}

export class DocBlockParser {

    private stripPattern: RegExp = /^\/\*\*\s*|\s*\*\/$|^[ \t]*\*[ \t]*/mg;
    private tagBoundaryPattern: RegExp = /(?:\n|\r\n)(?=@)/;
    private tagPattern: RegExp = /^(@param|@var|@property|@property-read|@property-write|@return|@throws)\s+(\S+)\s+(\$\S+)?\s*([^]*)$|^(@method)\s+(\S+\s+)?(\S+)\(\s*([^]*)\s*\)\s*([^]*)$/;

    parse(input: string) {

        if (!input) {
            return null;
        }

        //strip open, closing tags and newline asterix
        //split on tag boundaries
        let split: string[] = input.replace(this.stripPattern, '')
            .split(this.tagBoundaryPattern);

        let text: string = '';
        if (split[0] && split[0][0] !== '@') {
            //treat phpdoc summary and description as a single block of text
            text = split.shift();
        }

        let match: RegExpMatchArray;
        let tagString: string;
        let tags: Tag[] = [];
        let tag: Tag;
        while (tagString = split.shift()) {
            //parse @param, @var, @property*, @return, @throws, @method tags
            if (!(match = tagString.match(this.tagPattern))) {
                continue;
            }

            if (match[1]) {
                tags.push(<TypeTag>{
                    tagName: match[1],
                    types: this.splitTypeString(match[2]),
                    name: match[3] ? match[3] : '',
                    description: match[4] ? match[4] : ''
                });
            } else {
                tags.push(<MethodTag>{
                    tagName: match[5],
                    returnTypes: this.splitTypeString(match[6] ? match[6] : 'void'),
                    name: match[7],
                    parameters: this.parseMethodParameters(match[8]),
                    description: match[9] ? match[9] : ''
                });
            }

            tags.push(tag);
        }

        //must have at least text or a tag
        if (!text && !tags.length) {
            return null;
        }

        return {
            text: text,
            tags: tags
        };

    }

    private splitTypeString(text: string) {
        if (!text) {
            return [];
        }

        return text.split('|');
    }


    private parseMethodParameters(input: string): MethodTagParam[] {

        if (!input) {
            return [];
        }

        let params: MethodTagParam[] = [];
        let paramSplit = input.split(/\s*,\s/);
        let paramTypes: string, paramName: string;
        for (let n = 0; n < paramSplit.length; ++n) {
            [paramTypes, paramName] = paramSplit[n].split(/\s+/);
            if (paramTypes && paramName) {
                params.push({
                    types: this.splitTypeString(paramTypes),
                    name: paramName
                });
            }
        }

        return params;
    }

}

export interface TypeTag extends Tag {
    types: string[]
}

export interface MethodTagParam {
    types: string[],
    name: string
}

export interface MethodTag extends Tag {
    returnTypes: string[],
    parameters: MethodTagParam[]
}

export interface Tag {
    tagName: string,
    name: string,
    description: string
}

export interface DocBlock {
    text: string,
    tags: Tag[]
}