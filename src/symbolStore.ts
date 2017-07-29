/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */

'use strict';

import { PhpSymbol, SymbolIndex, SymbolKind, SymbolModifier, Reference, SymbolIdentifier } from './symbol';
import { TreeTraverser, Predicate, TreeVisitor, Traversable } from './types';
import { Position, Location, Range } from 'vscode-languageserver-types';
import { TypeString } from './typeString';
import * as builtInSymbols from './builtInSymbols.json';
import { ParsedDocument, ParsedDocumentChangeEventArgs } from './parsedDocument';
import { SymbolReader } from './symbolReader';
import { NameResolver } from './nameResolver';
import * as util from './util';

export class SymbolTable implements Traversable<PhpSymbol> {

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

    nameResolver(pos: Position) {
        let nameResolver = new NameResolver();
        let traverser = new TreeTraverser([this.root]);
        let visitor = new NameResolverVisitor(pos, nameResolver);
        traverser.traverse(visitor);
        return nameResolver;
    }

    scope(pos:Position) {
        let traverser = new TreeTraverser([this.root]);
        let visitor = new ScopeVisitor(pos, this.root);
        traverser.traverse(visitor);
        return visitor.scope;
    }

    scopeSymbols() {
        return this.filter(this._isScopeSymbol);
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

    private _isScopeSymbol(s: PhpSymbol) {
        const mask = SymbolKind.Class | SymbolKind.Interface | SymbolKind.Trait | SymbolKind.None | SymbolKind.Function | SymbolKind.Method;
        return (s.kind & mask) > 0;
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

    findSymbolsByReference(ref:Reference): PhpSymbol[] {

    }

    findReferences(identifier:SymbolIdentifier):Reference[] {

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

class NameResolverVisitor implements TreeVisitor<PhpSymbol> {

    haltTraverse = false;
    private _kindMask = SymbolKind.Class | SymbolKind.Function | SymbolKind.Constant;

    constructor(public pos: Position, public nameResolver: NameResolver) { }

    preorder(node: PhpSymbol, spine: PhpSymbol[]) {

        if (node.location && node.location.range.start.line > this.pos.line) {
            this.haltTraverse = true;
            return false;
        }

        if ((node.modifiers & SymbolModifier.Use) > 0 && (node.kind & this._kindMask) > 0) {
            this.nameResolver.rules.push(node);
        } else if (node.kind === SymbolKind.Namespace) {
            this.nameResolver.namespace = node;
        } else if (node.kind === SymbolKind.Class) {
            this.nameResolver.pushClass(node);
        }

        return true;

    }

    postorder(node: PhpSymbol, spine: PhpSymbol[]) {

        if (this.haltTraverse) {
            return;
        }

        if (node.kind === SymbolKind.Class) {
            this.nameResolver.popClass();
        }

    }
}

class ScopeVisitor implements TreeVisitor<PhpSymbol> {

    haltTraverse = false;
    private _scope:PhpSymbol;
    private _kindMask = SymbolKind.Class | SymbolKind.Interface | SymbolKind.Trait | SymbolKind.Function | SymbolKind.Method;

    constructor(public pos:Position, defaultScope:PhpSymbol) { 
        this._scope = defaultScope;
    }

    get scope() {
        return this._scope;
    }

    preorder(node:PhpSymbol, spine:PhpSymbol[]) {

        if (node.location && node.location.range.start.line > this.pos.line) {
            this.haltTraverse = true;
            return false;
        }

        if(node.location && util.isInRange(this.pos, node.location.range.start, node.location.range.end) !== 0) {
            return false;
        }

        if(
            (node.kind & this._kindMask) > 0 && 
            !(node.modifiers & SymbolModifier.Use) && 
            node.location && util.isInRange(this.pos, node.location.range.start, node.location.range.end) === 0
        ) {
            this._scope = node;
        }

        return true;
    }

}
