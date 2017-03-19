/* Copyright (c) Ben Mewburn ben@mewburn.id.au
 * Licensed under the MIT Licence.
 */

'use strict';

import { TextDocument, DocumentStore } from './document';
import { Parser } from 'php7parser';
import { ParseTree, ParseTreeStore } from './parseTree';
import { SymbolStore } from './symbol';

export namespace Intelephense {

    var documentStore = new DocumentStore();
    var parseTreeStore = new ParseTreeStore();
    var symbolStore = new SymbolStore();

    export function openDocument(uri: string, documentText: string) {

        let doc = new TextDocument(uri, documentText);
        documentStore.add(doc);
        let parseTree = new ParseTree(uri, Parser.parse(documentText));
        parseTreeStore.add(parseTree);
        let symbolTable = 

    }

    export function closeDocument(uri: string) {

    }

    export function syncDocument(uri: string, documentText: string) {


    }

    export function documentSymbols(uri: string) {

    }


}
