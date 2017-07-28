/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */

'use strict';

import * as lsp from 'vscode-languageserver-types';
import {ParsedDocumentStore, ParsedDocument} from './parsedDocument';

export class ReferenceProvider {

    constructor(public documentStore:ParsedDocumentStore) {

    }

    provideReferences(uri:string, position:lsp.Position, referenceContext:lsp.ReferenceContext) {

        let doc = this.documentStore.find(uri);
        if(!doc) {
            return [];
        }

        let docTraverser = doc.createTraverser()

    }
}