/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */

'use strict';

import { Predicate, TreeVisitor, TreeTraverser, NameIndex } from './types';
import { SymbolIdentifier, SymbolKind } from './symbol';
import { Range, Location } from 'vscode-languageserver-types';
import * as util from './util';

export interface Reference extends SymbolIdentifier {
    location: Location;
    type?: string;
    altName?: string;
}

export namespace Reference {
    export function create(kind: SymbolKind, name: string, location: Location): Reference {
        return {
            kind: kind,
            name: name,
            location: location
        };
    }
}

export interface Scope {
    range: Range;
    children: (Scope | Range)[]
}

export class ReferenceTable {

    private _uri: string;
    private _root: Scope;
    private _hash: number;

    constructor(uri: string, root: Scope) {
        this._uri = uri;
        this._root = root;
        this._hash = util.hash32(uri);
    }

    get uri() {
        return this._uri;
    }

    get root() {
        return this._root;
    }

    get hash() {
        return this._hash;
    }

    get referenceCount() {
        return this.references().length;
    }

    references(filter?: Predicate<Reference>) {
        let traverser = new TreeTraverser([this.root]);
        let visitor = new ReferencesVisitor(filter);
        traverser.traverse(visitor);
        return visitor.references;
    }

    referenceAtPosition(position: Position) {



    }
}

interface ReferenceTableSummary {
    uri:string;
    identifiers:string[];
}

export class ReferenceStore {

    private _tables: ReferenceTable[];
    private _refIndex: NameIndex<ReferenceTableSummary>;

    constructor() {
        this._refIndex = new NameIndex<ReferenceTableSummary>((x)=>{ return x.identifiers; });
        this._tables = [];
    }

    getReferenceTable(uri: string) {
        for(let n = 0; n < this._tables.length; ++n) {
            if(this._tables[n].uri === uri) {
                return this._tables[n];
            }
        }
        return undefined;
    }

    add(table: ReferenceTable) {
        
    }

    remove(uri: string, purge?: boolean) {

    }

    close(uri: string) {

    }

    closeAll() {

    }

    find(name: string, filter?: Predicate<Reference>): Promise<Reference[]> {


        if (!name) {
            return [];
        }

        let matches = this._referenceIndex.find(name);
        let filtered: Reference[] = [];
        let match: Reference;
        const caseSensitiveKindMask = SymbolKind.Property | SymbolKind.Variable | SymbolKind.Constant | SymbolKind.ClassConstant;

        for (let n = 0; n < matches.length; ++n) {
            match = matches[n];
            if (!filter || filter(match)) {
                if (!(match.kind & caseSensitiveKindMask) || name === match.name) {
                    filtered.push(match);
                }
            }
        }

        return filtered;

    }

    private _indexableReferenceFilter(ref: Reference) {
        return ref.kind !== SymbolKind.Parameter && ref.kind !== SymbolKind.Variable;
    }

    private _referenceKeys(ref: Reference) {
        
                let lcName = ref.name.toLowerCase();
                let keys = [lcName];
                if (ref.altName) {
                    let lcAlt = ref.altName.toLowerCase();
                    if (lcAlt !== lcName && lcAlt !== 'static' && lcAlt !== 'self' && lcAlt !== 'parent') {
                        keys.push(lcAlt);
                    }
                }
        
                return keys;
        
            }


}

class ReferencesVisitor implements TreeVisitor<Scope | Reference> {

    private _filter: Predicate<Reference>;
    private _refs: Reference[];

    constructor(filter?: Predicate<Reference>) {
        this._filter = filter;
        this._refs = [];
    }

    get references() {
        return this._refs;
    }

    preorder(node: Scope | Reference, spine: (Scope | Reference)[]) {

        if ((<Reference>node).kind !== undefined && (!this._filter || this._filter(<Reference>node))) {
            this._refs.push(<Reference>node);
        }

        return true;

    }

}