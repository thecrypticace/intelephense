import { ParsedDocument } from './parsedDocument';
import * as lsp from 'vscode-languageserver-types';
export declare class DiagnosticsProvider {
    diagnose(doc: ParsedDocument): lsp.Diagnostic[];
    private _parseErrorToDiagnostic(err, doc);
}
