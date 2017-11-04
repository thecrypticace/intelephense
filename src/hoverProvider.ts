/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */

'use strict';

import { ParsedDocumentStore } from './parsedDocument';
import { SymbolStore } from './symbolStore';
import { SymbolKind, PhpSymbol } from './symbol';
import { ReferenceStore } from './reference';
import { Position, Hover } from 'vscode-languageserver-types';
import { MemberMergeStrategy } from './typeAggregate';

export class HoverProvider {

    constructor(public docStore: ParsedDocumentStore, public symbolStore: SymbolStore, public refStore: ReferenceStore) {

    }


    provideHover(uri: string, pos: Position): Hover {


        let doc = this.docStore.find(uri);
        let table = this.refStore.getReferenceTable(uri);

        if (!doc || !table) {
            return undefined;
        }

        let ref = table.referenceAtPosition(pos);

        if (!ref) {
            return undefined;
        }

        let symbol = this.symbolStore.findSymbolsByReference(ref, MemberMergeStrategy.Override).shift();

        if (!symbol) {
            undefined;
        }

        switch (symbol.kind) {

            case SymbolKind.Function:
            case SymbolKind.Method:
                return {
                    contents: PhpSymbol.signatureString(symbol),
                    range: ref.location.range
                };

            case SymbolKind.Parameter:
            case SymbolKind.Property:
                return {
                    contents: [PhpSymbol.type(symbol), symbol.name].join(' ').trim(),
                    range: ref.location.range
                };

            case SymbolKind.Variable:
                return {
                    contents: [ref.type, symbol.name].join(' ').trim(),
                    range: ref.location.range
                };

            default:
                return undefined;

        }


    }

}