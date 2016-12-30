/* Copyright © Ben Mewburn ben@mewburn.id.au
 * Licensed under the MIT Licence.
 */

'use strict';

import { Tree, BinarySearch } from './types';
import { Token, Phrase, AstNodeFactory, Position } from 'php7parser';
import * as util from './util';

export class ParsedDocument {

    private _tokens: Token[];
    private _parseTree: ParseTree;
    private _tokenSearch:BinarySearch<Token>;
    private _uri:string;

    constructor(uri:string, tokens: Token[], parseTree: ParseTree) {
        this._uri = uri;
        this._tokens = tokens;
        this._parseTree = parseTree;
        this._tokenSearch = new BinarySearch<Token>(this._tokens);
    }

    get uri(){
        return this._uri;
    }

    get tokens() {
        return this._tokens;
    }

    get parseTree() {
        return this._parseTree;
    }

    tokenIndexAtPosition(pos:Position){
        return this._tokenSearch.rank((t)=>{
            return util.isInRange(pos, t.range.start, t.range.end);
        });
    }
}

export class AstStore {

    private _map:{[index:string]:ParsedDocument};

    constructor(){
        this._map = {};
    }

    add(parsedDoc:ParsedDocument){
        this._map[parsedDoc.uri] = parsedDoc;
    }

    remove(uri:string){
        delete this._map[uri];
    }

    getParsedDocument(uri:string){
        return this._map[uri];
    }

}

export class ParseTree extends Tree<Phrase | Token> {

    private _uri;

    constructor(uri) {
        super(null);
        this._uri = uri;
    }

    get uri() {
        return this._uri;
    }
}

export var astNodeFactory: AstNodeFactory<Tree<Phrase | Token>> = function (value, children) {
    let tree = new Tree<Phrase | Token>(value);
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


