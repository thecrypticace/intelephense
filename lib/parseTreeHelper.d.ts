import { Phrase } from 'php7parser';
import { SymbolKind } from './symbol';
export declare namespace ParseTreeHelper {
    function phraseToReferencesSymbolKind(node: Phrase): SymbolKind;
}
