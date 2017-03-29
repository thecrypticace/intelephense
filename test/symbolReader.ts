import { SymbolReader, NameResolver, PhpSymbol, SymbolKind, SymbolTable } from '../src/symbol';
import { TextDocument } from '../src/document';
import { ParseTree } from '../src/parse';
import { Parser } from 'php7parser';
import { TreeTraverser } from '../src/types';
import { expect } from 'chai';
import 'mocha';

function symbolReaderOutput(src: string) {

    let doc = new TextDocument('test', src);
    let parseTree = Parser.parse(src);
    let symbolTree: PhpSymbol = { kind: SymbolKind.None, name: '' };
    let sr = new SymbolReader(doc, new NameResolver('', '', []), [symbolTree]);
    let traverser = new TreeTraverser([parseTree]);
    traverser.traverse(sr);
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