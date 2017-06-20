import * as lsp from 'vscode-languageserver-types';
import { ParsedDocumentStore } from './parsedDocument';
import { SymbolStore } from './symbolStore';
export interface ImportSymbolTextEdits {
    edits: lsp.TextEdit[];
    /**
     * If true an alias is required and is expected to be appended to each TextEdit.newText
     */
    aliasRequired?: boolean;
}
export declare function importSymbol(symbolStore: SymbolStore, documentStore: ParsedDocumentStore, textDocument: lsp.TextDocumentIdentifier, position: lsp.Position): ImportSymbolTextEdits;
