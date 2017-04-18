import { VariableTypeResolver, NameResolver, SymbolStore, VariableTable, SymbolTable } from '../src/symbol';
import { TreeTraverser } from '../src/types';
import { ParsedDocument } from '../src/parsedDocument';
import {Token, TokenType, Phrase} from 'php7parser';
import { assert } from 'chai';
import 'mocha';



function setup(phpSrc: string): [ParsedDocument, VariableTypeResolver] {

    let symbolStore = new SymbolStore();
    let doc = new ParsedDocument('test', phpSrc);
    let symbolTable = SymbolTable.create(doc);
    symbolStore.add(symbolTable);
    let variableTable = new VariableTable();
    let variableTypeResolver = new VariableTypeResolver(variableTable, doc, new NameResolver(doc, [], '', '', ''), symbolStore);
    return [doc, variableTypeResolver];

}

describe('VariableTypeResolver', function () {

    it('Object creation simple assignment', function () {

        let src =
            `<?php
    class MyClass1 { }
    class MyClass2 { }

    $myVar1 = new MyClass1();
    $myVar2 = $myVar1;

`

        let doc: ParsedDocument;
        let varResolver: VariableTypeResolver;

        [doc, varResolver] = setup(src);

        let traverser = new TreeTraverser([doc.tree]);
        traverser.traverse(varResolver);

        assert.equal(varResolver.variableTable.getType('$myVar1', '').toString(), 'MyClass1');
        assert.equal(varResolver.variableTable.getType('$myVar2', '').toString(), 'MyClass1');

    });

    it('should resolve param types', function () {

        let src = `<?php
        class Foo {

        public function fooFn(int $value = 1){
            
        }

    }

    class Bar extends Foo {

        /** 
        * @param Foo $value 
        * @return Baz 
        */
        function fn($value) {
            $value->
        }
    }
        `;

        let doc: ParsedDocument;
        let resolver: VariableTypeResolver;
        [doc, resolver] = setup(src);

        let v = new TreeTraverser<Phrase|Token>([doc.tree]).find((x)=>{
            return (<Token>x).tokenType === TokenType.Arrow;
        }) as Token;

        resolver.haltAtToken = v;

        let traverser = new TreeTraverser([doc.tree]);
        traverser.traverse(resolver);

        assert.equal(resolver.variableTable.getType('$value', '').toString(), 'Foo');

    });

    it('Object creation simple assignment', function () {

        let src =
            `<?php
    class MyClass1 { 
        function fn(){}
    }
    class MyClass2 { }

    $myVar1 = new MyClass1();
    $myVar2 = $myVar1->

`;

        let doc: ParsedDocument;
        let resolver: VariableTypeResolver;

        [doc, resolver] = setup(src);

        let v = new TreeTraverser<Phrase|Token>([doc.tree]).find((x)=>{
            return (<Token>x).tokenType === TokenType.Arrow;
        }) as Token;

        resolver.haltAtToken = v;

        let traverser = new TreeTraverser([doc.tree]);
        traverser.traverse(resolver);

        let varTable = resolver.variableTable;
        console.log(JSON.stringify(varTable, null, 4));

        //assert.equal(resolver.variableTable.getType('$myVar1', '').toString(), 'MyClass1');
        //assert.equal(resolver.variableTable.getType('$myVar2', '').toString(), 'MyClass1');

    });


});