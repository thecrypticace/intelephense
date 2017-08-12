import { Position, ReferenceContext, Location } from 'vscode-languageserver-types';
import { ParsedDocumentStore } from './parsedDocument';
import { SymbolStore, SymbolTable } from './symbolStore';
import { PhpSymbol, SymbolIdentifier } from './symbol';
export declare class ReferenceProvider {
    documentStore: ParsedDocumentStore;
    symbolStore: SymbolStore;
    constructor(documentStore: ParsedDocumentStore, symbolStore: SymbolStore);
    provideReferenceLocations(uri: string, position: Position, referenceContext: ReferenceContext): Location[];
    /**
     *
     * @param symbols must be base symbols where kind is method, class const or prop
     * @param table
     * @param includeDeclaration
     */
    provideReferences(symbols: PhpSymbol[], table: SymbolTable, includeDeclaration: boolean): SymbolIdentifier[];
    private _provideReferences(symbol, table);
    private _methodReferences(symbol, table);
    private _classConstantReferences(symbol, table);
    private _propertyReferences(symbol, table);
    private _createMemberReferenceFilterFn(baseMember);
    private _variableReferences(symbol, table);
}
