/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */

'use strict';

import { Location, Position } from 'vscode-languageserver-types';
import { PhpSymbol, SymbolKind } from './symbol';
import { SymbolStore } from './symbolStore';
import { ParsedDocument, ParsedDocumentStore } from './parsedDocument';
import { ParseTreeTraverser } from './parseTreeTraverser';
import { TypeString } from './typeString';
import { Phrase, PhraseType, Token, TokenType } from 'php7parser';
import { TreeTraverser } from './types';
import { MemberMergeStrategy } from './typeAggregate';

export class DefinitionProvider {

    constructor(public symbolStore: SymbolStore, public documentStore: ParsedDocumentStore) { }

    provideDefinition(uri: string, position: Position) {

        let doc = this.documentStore.find(uri);
        let table = this.symbolStore.getSymbolTable(uri);

        if (!doc || !table) {
            return null;
        }

        let ref = table.referenceAtPosition(position);

        if (!ref) {
            return null;
        }

        let symbols = this.symbolStore.findSymbolsByReference(ref, MemberMergeStrategy.Override);
        let locations: Location[] = [];
        let s: PhpSymbol;
        let loc: Location;

        for (let n = 0; n < symbols.length; ++n) {
            s = symbols[n];
            if (s.location && (loc = this.symbolStore.identifierLocation(s))) {
                locations.push(loc);
            }
        }

        return locations.length === 1 ? locations[0] : locations;

    }

}