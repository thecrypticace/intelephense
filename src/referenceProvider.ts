/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */

'use strict';

import {Position, ReferenceContext, Location} from 'vscode-languageserver-types';
import {ParsedDocumentStore, ParsedDocument} from './parsedDocument';
import { Context } from './context';
import {SymbolStore} from './symbolStore';
import {Reference, PhpSymbol} from './symbol';

export class ReferenceProvider {

    constructor(public documentStore:ParsedDocumentStore, public symbolStore:SymbolStore) {

    }

    provideReferences(uri:string, position:Position, referenceContext:ReferenceContext) {

        let locations:Location[] = [];
        let doc = this.documentStore.find(uri);
        
        if(!doc) {
            return locations;
        }

        let context = new Context(this.symbolStore, doc, position);
        let symbols:PhpSymbol[];
        let identifier = context.reference;

        if(identifier) {
            symbols = this.symbolStore.findSymbolsByReference(identifier);
        } else if(!identifier && context.isDeclaration()) {
            identifier = context.scopeSymbol;
            symbols = [identifier];
        }

        if(!identifier) {
            return locations;
        }

        let references = this.symbolStore.findReferences(identifier);
        for(let n = 0; n < references.length; ++n) {
            locations.push(references[n].location);
        }

        if(referenceContext.includeDeclaration){
            let loc:Location;
            for(let n = 0; n < symbols.length; ++n) {
                loc = symbols[n].location;
                if(loc){
                    locations.unshift(loc);
                }
            }
        }

        return locations;

    }

}