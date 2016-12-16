/* Copyright © Ben Mewburn ben@mewburn.id.au
 * Licensed under the MIT Licence.
 */

'use strict';

import { Tree } from './types';
import { Token, NonTerminal, AstNodeFactory } from 'php7parser';

export class ParsedDocument {

    private _tokens: Token[];
    private _parseTree: ParseTree;

    constructor(tokens: Token[], parseTree: ParseTree) {
        this._tokens = tokens;
        this._parseTree = parseTree;
    }

    get tokens() {
        return this._tokens;
    }

    get parseTree() {
        return this._parseTree;
    }
}

export class ParseTree extends Tree<NonTerminal | Token> {

    private _uri;

    constructor(uri) {
        super(null);
        this._uri = uri;
    }

    get uri() {
        return this._uri;
    }
}

export var astNodeFactory: AstNodeFactory<Tree<NonTerminal | Token>> = function (value, children) {
    let tree = new Tree<NonTerminal | Token>(value);
    tree.addChildren(children);
    return tree;
}

export class PhpDocParser {

    private static stripPattern: RegExp = /^\/\*\*\s*|\s*\*\/$|^[ \t]*\*[ \t]*/mg;
    private static tagBoundaryPattern: RegExp = /(?:\r\n|\r|\n)(?=@)/;
    private static tagPattern: RegExp = new RegExp(
        /^(@param|@var|@property|@property-read|@property-write|@return|@throws)\s+(\S+)\s+(\$\S+)?\s*([^]*)$/.source
        + '|' + /^(@method)\s+(\S+\s+)?(\S+)\(\s*([^]*)\s*\)(?!\[)\s*([^]*)$/.source
    );
    private static summaryBoundary: RegExp = /\.(?:\r\n|\r|\n)|(?:\r\n|\r|\n){2}/;
    private static methodParamPartBoundary: RegExp = /\s*,\s*|\s+/;

    parse(input: string) {

        if (!input) {
            return null;
        }

        //strip open, closing tags and newline asterix
        //split on tag boundaries
        let split: string[] = input.replace(PhpDocParser.stripPattern, '')
            .split(PhpDocParser.tagBoundaryPattern);

        let text: string = '';
        if (split[0] && split[0][0] !== '@') {
            //keep summary, discard description
            text = split.shift().split(PhpDocParser.summaryBoundary).shift();
        }

        let match: RegExpMatchArray;
        let tagString: string;
        let tags: Tag[] = [];
        let tag: Tag;
        while (tagString = split.shift()) {
            //parse @param, @var, @property*, @return, @throws, @method tags
            if (!(match = tagString.match(PhpDocParser.tagPattern))) {
                continue;
            }

            if (match[1]) {
                tags.push(this._typeTag(match[1], match[2], match[3], match[4]));
            } else {
                tags.push(this._methodTag(match[5], match[6], match[7],
                    this._parseMethodParameters(match[8]), match[9]));
            }

            tags.push(tag);
        }

        //must have at least text or a tag
        if (!text && !tags.length) {
            return null;
        }

        return {
            summary: text,
            tags: tags
        };

    }

    private _typeTag(tagName: string, typeString: string, name: string, description: string): TypeTag {
        return {
            tagName: tagName,
            typeString: typeString,
            name: name ? name : '',
            description: description ? description : ''
        };
    }

    private _methodTag(tagName: string, returnTypeString: string, name: string,
        parameters: MethodTagParam[], description: string): MethodTag {
        return {
            tagName: tagName,
            returnTypeString: returnTypeString ? returnTypeString : 'void',
            name: name,
            parameters: parameters,
            description: description ? description : ''
        };
    }

    private _parseMethodParameters(input: string): MethodTagParam[] {

        if (!input) {
            return [];
        }

        let params: MethodTagParam[] = [];
        let paramSplit = input.split(PhpDocParser.methodParamPartBoundary);
        let typeString: string, name: string;

        while (paramSplit.length) {

            name = paramSplit.pop();
            typeString = paramSplit.pop();

            if (name && typeString) {
                params.push({
                    typeString: typeString,
                    name: name
                });
            }

        }

        return params.reverse();
    }

}

export interface TypeTag extends Tag {
    typeString: string;
}

export interface MethodTagParam {
    typeString: string;
    name: string;
}

export interface MethodTag extends Tag {
    returnTypeString: string;
    parameters: MethodTagParam[];
}

export interface Tag {
    tagName: string;
    name: string;
    description: string;
}

export interface PhpDoc {
    summary: string;
    tags: Tag[];
}


