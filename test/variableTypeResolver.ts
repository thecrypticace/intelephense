import { VariableTypeResolver, NameResolver, SymbolStore, VariableTable, SymbolTable } from '../src/symbol';
import {TreeTraverser} from '../src/types';
import {ParsedDocument} from '../src/parsedDocument';
import { assert } from 'chai';
import 'mocha';

var src = 
`<?php
    class MyClass1 { }
    class MyClass2 { }

    $myVar1 = new MyClass1();
    $myVar2 = $myVar1;

`

var symbolStore:SymbolStore;
var doc:ParsedDocument;
var variableTypeResolver:VariableTypeResolver;
var symbolTable:SymbolTable;
var variableTable:VariableTable;

function setup(phpSrc:string){

    symbolStore = new SymbolStore();
    doc = new ParsedDocument('test', phpSrc);
    symbolTable = SymbolTable.create(doc);
    symbolStore.add(symbolTable);
    variableTable = new VariableTable();
    variableTypeResolver = new VariableTypeResolver(variableTable, doc, new NameResolver(doc, [], '','',''), symbolStore);

}

describe('VariableTypeResolver', function(){

    it('Object creation simple assignment', function(){
        setup(src);

        let traverser = new TreeTraverser([doc.tree]);
        traverser.traverse(variableTypeResolver);

        assert.equal(variableTable.getType('$myVar1', '').toString(), 'MyClass1');
        assert.equal(variableTable.getType('$myVar2', '').toString(), 'MyClass1');

    });

});