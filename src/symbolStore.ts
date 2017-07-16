/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */

'use strict';

import { PhpSymbol, SymbolIndex, SymbolKind, SymbolModifier, PhpSymbolDto } from './symbol';
import { TreeTraverser, Predicate, TreeVisitor } from './types';
import { Position, Location, Range } from 'vscode-languageserver-types';
import { TypeString } from './typeString';
import * as builtInSymbols from './builtInSymbols.json';
import { ParsedDocument, ParsedDocumentChangeEventArgs } from './parsedDocument';
import { SymbolReader } from './symbolReader';
import { NameResolver } from './nameResolver';
import * as util from './util';

export class SymbolTable {

    constructor(
        public uri: string,
        public root: PhpSymbol
    ) { }

    get symbols() {
        let traverser = new TreeTraverser([this.root]);
        let symbols = traverser.toArray();
        //remove root
        symbols.shift();
        return symbols;
    }

    get count() {
        let traverser = new TreeTraverser([this.root]);
        //subtract 1 for root
        return traverser.count() - 1;
    }

    traverse(visitor: TreeVisitor<PhpSymbol>) {
        let traverser = new TreeTraverser([this.root]);
        traverser.traverse(visitor);
        return visitor;
    }

    filter(predicate: Predicate<PhpSymbol>) {
        let traverser = new TreeTraverser([this.root]);
        return traverser.filter(predicate)
    }

    find(predicate: Predicate<PhpSymbol>) {
        let traverser = new TreeTraverser([this.root]);
        return traverser.find(predicate);
    }

    symbolAtPosition(position: Position) {

        let pred = (x: PhpSymbol) => {
            return x.location &&
                x.location.range.start.line === position.line &&
                x.location.range.start.character === position.character;
        };

        return this.filter(pred).pop();
    }

    toDto() {
        return <SymbolTableDto>{
            uri: this.uri,
            root: (<ToPhpSymbolDtoVisitor>this.traverse(new ToPhpSymbolDtoVisitor())).root
        }
    }

    static fromDto(dto: SymbolTableDto) {

        let traverser = new TreeTraverser([dto.root]);
        let visitor = new ToPhpSymbolVisitor(dto.uri);
        traverser.traverse(visitor);
        return new SymbolTable(dto.uri, visitor.root);

    }

    static create(parsedDocument: ParsedDocument, externalOnly?: boolean) {

        let symbolReader = SymbolReader.create(
            parsedDocument,
            new NameResolver()
        );
        symbolReader.externalOnly = externalOnly;

        parsedDocument.traverse(symbolReader);
        return new SymbolTable(
            parsedDocument.uri,
            { kind: SymbolKind.None, name: '', children: symbolReader.symbols }
        );

    }

    static readBuiltInSymbols() {

        return new SymbolTable('\\', {
            kind: SymbolKind.None,
            name: '',
            children: <any>builtInSymbols
        });

    }

}

export interface MemberQuery {
    typeName: string;
    memberPredicate: Predicate<PhpSymbol>;
}

export class SymbolStore {

    private _map: { [index: string]: SymbolTable };
    private _index: SymbolIndex;
    private _symbolCount: number;

    constructor() {
        this._map = {};
        this._index = new SymbolIndex();
        this._symbolCount = 0;
    }

    onParsedDocumentChange = (args: ParsedDocumentChangeEventArgs) => {
        this.remove(args.parsedDocument.uri);
        this.add(SymbolTable.create(args.parsedDocument));
    };

    getSymbolTable(uri: string) {
        return this._map[uri];
    }

    get tableCount() {
        return Object.keys(this._map).length;
    }

    get symbolCount() {
        return this._symbolCount;
    }

    add(symbolTable: SymbolTable) {
        if (this.getSymbolTable(symbolTable.uri)) {
            throw new Error(`Duplicate key ${symbolTable.uri}`);
        }
        this._map[symbolTable.uri] = symbolTable;
        this._index.addMany(this._indexSymbols(symbolTable.root));
        this._symbolCount += symbolTable.count;
    }

    remove(uri: string) {
        let symbolTable = this.getSymbolTable(uri);
        if (!symbolTable) {
            return;
        }
        this._index.removeMany(this._indexSymbols(symbolTable.root));
        this._symbolCount -= symbolTable.count;
        delete this._map[uri];
    }

    /**
     * Finds all indexed symbols that match text exactly.
     * Case sensitive for constants and variables and insensitive for 
     * classes, traits, interfaces, functions, methods
     * @param text 
     * @param filter 
     */
    find(text: string, filter?: Predicate<PhpSymbol>) {
        let lcText = text.toLowerCase();
        let kindMask = SymbolKind.Constant | SymbolKind.Variable;
        let result = this._index.find(text);
        let symbols: PhpSymbol[] = [];
        let s: PhpSymbol;

        for (let n = 0, l = result.length; n < l; ++n) {
            s = result[n];
            if ((!filter || filter(s)) &&
                (((s.kind & kindMask) > 0 && s.name === text) ||
                    (!(s.kind & kindMask) && s.name.toLowerCase() === lcText))) {
                symbols.push(s);
            }
        }

        return symbols;
    }

    /**
     * Fuzzy matches indexed symbols.
     * Case insensitive
     */
    match(text: string, filter?: Predicate<PhpSymbol>) {

        if (!text) {
            return [];
        }

        let substrings: string[];

        if (text.length > 3) {
            let trigrams = util.trigrams(text);
            trigrams.add(text);
            substrings = Array.from(trigrams);
        } else {
            substrings = [text];
        }

        let matches: PhpSymbol[] = [];
        for (let n = 0; n < substrings.length; ++n) {
            Array.prototype.push.apply(matches, this._index.match(substrings[n]));
        }

        matches = this._sortMatches(text, matches);

        if (!filter) {
            return matches;
        }

        let filtered: PhpSymbol[] = [];
        let s: PhpSymbol;

        for (let n = 0, l = matches.length; n < l; ++n) {
            s = matches[n];
            if (filter(s)) {
                filtered.push(s);
            }
        }

        return filtered;
    }

    private _sortMatches(query: string, matches: PhpSymbol[]) {

        let map: { [index: string]: number } = {};
        let s: PhpSymbol;
        let name: string;
        let checkIndexOf = query.length > 3;
        let val: number;
        query = query.toLowerCase();

        for (let n = 0, l = matches.length; n < l; ++n) {
            s = matches[n];
            name = s.name;
            if (map[name] === undefined) {
                val = 0;
                if (checkIndexOf) {
                    val = (PhpSymbol.notFqn(s.name).toLowerCase().indexOf(query) + 1) * -10;
                    if (val < 0) {
                        val += 1000;
                    }
                }
                map[name] = val;
            }
            ++map[name];
        }

        let unique = Array.from(new Set(matches));

        let sortFn = (a: PhpSymbol, b: PhpSymbol) => {
            return map[b.name] - map[a.name];
        }

        unique.sort(sortFn);
        return unique;

    }

    private _classOrInterfaceFilter(s: PhpSymbol) {
        return (s.kind & (SymbolKind.Class | SymbolKind.Interface)) > 0;
    }

    private _classInterfaceTraitFilter(s: PhpSymbol) {
        return (s.kind & (SymbolKind.Class | SymbolKind.Interface | SymbolKind.Trait)) > 0;
    }

    private _indexSymbols(root: PhpSymbol) {

        let traverser = new TreeTraverser([root]);
        return traverser.filter(this._indexFilter);

    }

    private _indexFilter(s: PhpSymbol) {
        return s.kind !== SymbolKind.Parameter &&
            (s.kind !== SymbolKind.Variable || !s.scope) && //script level vars
            !(s.modifiers & SymbolModifier.Use) &&
            s.name.length > 0;
    }



}

export interface SymbolTableDto {
    uri: string;
    root: PhpSymbolDto;
}

class ToPhpSymbolDtoVisitor implements TreeVisitor<PhpSymbol> {

    private _dtoStack;

    constructor() {
        this._dtoStack = [];
    }

    get root() {
        return this._dtoStack.length ? this._dtoStack[0] : null;
    }

    preorder(node: PhpSymbol, spine: PhpSymbol[]) {

        let parent = this._dtoStack.length ? this._dtoStack[this._dtoStack.length - 1] : null;

        let dto = <PhpSymbolDto>{
            kind: node.kind,
            name: node.name
        };

        if (node.modifiers) {
            dto.modifiers = node.modifiers;
        }

        if (node.location) {
            dto.location = this._rangeToArray(node.location.range)
        }

        if (node.associated) {
            dto.associated = this._associatedToAssociatedDto(node.associated);
        }

        if (node.doc) {
            dto.doc = node.doc
        }

        if (node.scope) {
            dto.scope = node.scope;
        }

        if (node.value) {
            dto.value = node.value;
        }

        if (node.type) {
            dto.type = node.type.toString();
        }

        if (parent) {
            if (!parent.children) {
                parent.children = [];
            }

            parent.children.push(dto);
        }

        this._dtoStack.push(dto);
        return true;

    }

    postorder(node: PhpSymbol, spine: PhpSymbol[]) {
        if (this._dtoStack.length > 1) {
            this._dtoStack.pop();
        }
    }

    private _rangeToArray(range: Range) {
        return [
            range.start.line,
            range.start.character,
            range.end.line,
            range.end.character
        ];
    }

    private _associatedToAssociatedDto(associated: PhpSymbol[]) {

        let dtos: PhpSymbolDto[] = [];
        let s: PhpSymbol;
        for (let n = 0, l = associated.length; n < l; ++n) {
            s = associated[n];
            dtos.push({
                kind: s.kind,
                name: s.name
            });
        }

        return dtos;
    }

}

class ToPhpSymbolVisitor implements TreeVisitor<PhpSymbolDto> {

    private _symbolStack: PhpSymbol[];

    constructor(public uri: string) {
        this._symbolStack = [];
    }

    get root() {
        return this._symbolStack.length ? this._symbolStack[0] : null;
    }

    preorder(node: PhpSymbolDto, spine: PhpSymbolDto[]) {

        let parent = this._symbolStack.length ? this._symbolStack[this._symbolStack.length - 1] : null;

        let s = <PhpSymbol>{
            kind: node.kind,
            name: node.name
        };

        if (node.modifiers) {
            s.modifiers = node.modifiers;
        }

        if (node.location) {
            s.location = this._arrayToLocation(this.uri, node.location);
        }

        if (node.associated) {
            s.associated = this._associatedDtoToAssociated(node.associated);
        }

        if (node.doc) {
            s.doc = node.doc
        }

        if (node.scope) {
            s.scope = node.scope;
        }

        if (node.value) {
            s.value = node.value;
        }

        if (node.type) {
            s.type = node.type;
        }


        if (parent) {
            if (!parent.children) {
                parent.children = [];
            }

            parent.children.push(s);
        }

        this._symbolStack.push(s);
        return true;
    }

    postorder(node: PhpSymbolDto, spine: PhpSymbolDto[]) {
        if (this._symbolStack.length > 1) {
            this._symbolStack.pop();
        }
    }

    private _associatedDtoToAssociated(associatedDto: PhpSymbolDto[]) {

        let associated: PhpSymbol[] = [];
        let dto: PhpSymbolDto;

        for (let n = 0, l = associatedDto.length; n < l; ++n) {
            dto = associatedDto[n];
            associated.push({
                kind: dto.kind,
                name: dto.name
            });
        }
        return associated;
    }

    private _arrayToLocation(uri: string, array: number[]) {

        return <Location>{
            uri: uri,
            range: {
                start: {
                    line: array[0],
                    character: array[1]
                },
                end: {
                    line: array[2],
                    character: array[3]
                }
            }
        };

    }


}

