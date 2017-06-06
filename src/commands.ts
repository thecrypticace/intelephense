/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */

'use strict';

import * as lsp from 'vscode-languageserver-types';
import { ParsedDocument, ParsedDocumentStore } from './parsedDocument';

export class ImportSymbolCommand {

    constructor(
        public docStore: ParsedDocumentStore
    ) { }

    execute(textDocument: lsp.TextDocumentIdentifier, position: lsp.Position) : lsp.TextEdit[] {

        let edits:lsp.TextEdit[] = [];
        let doc = this.docStore.find(textDocument.uri);
        
        if(!doc){
            return edits;
        }

        
        

    }

}
