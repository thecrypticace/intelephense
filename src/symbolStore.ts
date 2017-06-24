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
            new NameResolver(),
            [{ kind: SymbolKind.None, name: '', children: [] }]
        );
        symbolReader.externalOnly = externalOnly;

        parsedDocument.traverse(symbolReader);
        return new SymbolTable(
            parsedDocument.uri,
            symbolReader.spine[0]
        );

    }

    static readBuiltInSymbols() {

        SymbolTable.builtInSymbolTypeStrings(<any>builtInSymbols);
        return new SymbolTable('\\', {
            kind: SymbolKind.None,
            name: '',
            children: <any>builtInSymbols
        });

    }

    static builtInSymbolTypeStrings(symbols: any[]) {
        let s: any;
        for (let n = 0, l = symbols.length; n < l; ++n) {
            s = symbols[n];
            if (s.type) {
                s.type = new TypeString(s.type);
            }

            if (s.children) {
                SymbolTable.builtInSymbolTypeStrings(s.children);
            }
        }

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
     * As per match but returns first item in result that matches full text
     * the match is case sensitive for constants and variables and insensitive for 
     * classes, traits, interfaces, functions, methods
     * @param text 
     * @param filter 
     */
    find(text: string, filter?: Predicate<PhpSymbol>) {
        let lcText = text.toLowerCase();
        let kindMask = SymbolKind.Constant | SymbolKind.Variable;
        let exactMatchFn = (x: PhpSymbol) => {
            return (!filter || filter(x)) && 
                (((x.kind & kindMask) > 0 && x.name === text) || 
                (!(x.kind & kindMask) && x.name.toLowerCase() === lcText));
        };
        return this.match(text, exactMatchFn).shift();
    }

    /**
     * Matches any indexed symbol by name or partial name with optional additional filter
     * Parameters and variables that are not file scoped are not indexed.
     * case insensitive
     */
    match(text: string, filter?: Predicate<PhpSymbol>, fuzzy?: boolean) {

        if (!text) {
            return [];
        }

        let matched = this._index.match(text, fuzzy);

        if (!filter) {
            return matched;
        }

        let filtered: PhpSymbol[] = [];
        let s: PhpSymbol;

        for (let n = 0, l = matched.length; n < l; ++n) {
            s = matched[n];
            if (filter(s)) {
                filtered.push(s);
            }
        }

        return filtered;
    }

    private _classOrInterfaceFilter(s: PhpSymbol) {
        return (s.kind & (SymbolKind.Class | SymbolKind.Interface)) > 0;
    }

    lookupTypeMembers(query: MemberQuery) {
        let type = this.find(query.typeName, this._classOrInterfaceFilter);
        return this._lookupTypeMembers(type, query.memberPredicate, []);
    }

    lookupTypeMember(query: MemberQuery) {
        return this.lookupTypeMembers(query).shift();
    }

    lookupMembersOnTypes(queries: MemberQuery[]) {
        let symbols: PhpSymbol[] = [];

        for (let n = 0, l = queries.length; n < l; ++n) {
            Array.prototype.push.apply(symbols, this.lookupTypeMembers(queries[n]));
        }

        return symbols;
    }

    lookupMemberOnTypes(queries: MemberQuery[]) {
        return this.lookupMembersOnTypes(queries).shift();
    }

    /**
     * This will return duplicate symbols where members are overridden or already implemented
     * @param type 
     * @param predicate 
     * @param typeHistory 
     */
    private _lookupTypeMembers(type: PhpSymbol, predicate: Predicate<PhpSymbol>, typeHistory: string[]) {

        if (!type || typeHistory.indexOf(type.name) > -1) {
            return [];
        }

        //prevent cyclical lookup
        typeHistory.push(type.name);
        let members = type.children ? type.children.filter(predicate) : [];

        if (!type.associated) {
            return members;
        }

        //lookup in base class/traits
        let baseMemberPredicate: Predicate<PhpSymbol> = (x) => {
            return predicate(x) && !(x.modifiers & SymbolModifier.Private);
        };
        let baseSymbol: PhpSymbol;
        let basePredicate: Predicate<PhpSymbol>;

        for (let n = 0, l = type.associated.length; n < l; ++n) {
            baseSymbol = type.associated[n]; //stub symbol
            basePredicate = (x) => {
                return x.kind === baseSymbol.kind;
            };
            baseSymbol = this.find(baseSymbol.name, basePredicate);
            if (baseSymbol) {
                Array.prototype.push.apply(members, this._lookupTypeMembers(baseSymbol, baseMemberPredicate, typeHistory));
            }

        }

        return members;
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

        if (node.description) {
            dto.description = node.description
        }

        if (node.scope) {
            dto.scope = node.scope;
        }

        if (node.value) {
            dto.value = node.value;
        }

        if (node.typeSource) {
            dto.typeSource = node.typeSource;
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

    constructor(public uri:string) {
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

        if (node.description) {
            s.description = node.description
        }

        if (node.scope) {
            s.scope = node.scope;
        }

        if (node.value) {
            s.value = node.value;
        }

        if (node.typeSource) {
            s.typeSource = node.typeSource;
        }

        if (node.type) {
            s.type = new TypeString(node.type);
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
