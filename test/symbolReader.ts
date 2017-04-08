import { SymbolReader, NameResolver, PhpSymbol, SymbolKind, SymbolTable } from '../src/symbol';
import { ParsedDocument } from '../src/parsedDocument';
import { expect } from 'chai';
import 'mocha';

function symbolReaderOutput(src: string) {

    let parsedDoc = new ParsedDocument('test', src);
    let symbolTree: PhpSymbol = { kind: SymbolKind.None, name: '' };
    let sr = new SymbolReader(parsedDoc, new NameResolver(parsedDoc, [], '','',''), [symbolTree]);
    parsedDoc.traverse(sr);
    return symbolTree;

}

describe('SymbolReader', () => {

    it('Should read simple variables', () => {
        let src = `<?php 
                        $myVar = 1;
                        
                        function myFunction($myParam){}`;
        let output = symbolReaderOutput(src);
        console.log(JSON.stringify(output, null, 4));
    });
});