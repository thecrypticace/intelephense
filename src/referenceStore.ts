/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */

'use strict';

import {Predicate} from './types';


export class ReferenceTable {

}

export class ReferenceStore {


    getReferenceTable(uri:string) {
        
    }

    add(table:ReferenceTable) {

    }

    remove(uri:string) {

    }

    close(uri:string) {

    }

    open(uri:string):Promise<ReferenceTable> {

    }

    find(name:string, filter?: Predicate<Reference>):Promise<Reference[]> {

    }

}