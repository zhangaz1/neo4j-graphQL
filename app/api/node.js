﻿module.exports = function(config){
    
    "use strict";
    
  
    var _ = require("lodash");
    config = _.extend(require('./config.default'), config);
    var image = require("./image")(config);
    var label = require("./label")(config);
    var utils = require("./utils")(config);
    var type = require("./type")(config);
    var cypher = require("./cypher")(config);
    var graph = require("./graph")(config);
    var relationship = require("./relationship")(config);
    var changeCase = require("change-case");
     var predicate = require("./predicate")(config);
  var merge = require('deepmerge');
 // var extendify = require('extendify');
//read
//data[0].row 
//n , ID, labels
function parseNodeData(data){
    var n = utils.camelCase(data[0].row[0]);
    if (data[0].row[1]){
        n.id = data[0].row[1];
    }
    if (data[0].row[2]){
        n.labels = data[0].row[2];
        if (n.labels) {
            n.labels = n.labels.sort();
        }
    }
    return n;
}

//read
function getNode(match, where) {
    
    var q="match(" + match + ")  where " + where;
    q+=" with n optional match (" + match + ") -[:IMAGE] - (i:Image:Main)";
    q+= " return n,ID(n),LABELS(n),i ";
    return cypher.executeQuery(q)
    .then(function (data) {
        if (data.length) {

            var n = parseNodeData(data);
            if (data[0].row[3]){
               n.image = image.configure(data[0].row[3]);
            }
         //   addSchema(n);
            return n;
        }
        else {
            return null;
        }
    });
}

//read
function getNodeById(id) {
    return getNode("n", "ID(n) = " + id );
}

//read
function getNodeByLabel(label) {
    return getNode("n:Label", "n.Label = '" + label + "'");
}

//read
function addRelationships(n) {
   
    return relationship.list.conceptual(n).then(function(r){
        
        if (Object.keys(r).length){
            /*
            for (var key in r){
                if (r[key].predicate.direction==="in"){
                    n[r[key].predicate.reverse] = r[key].items;
                }
                else{
                    n[r[key].predicate.lookup] = r[key].items;
                }
            }
            */
            n.relationships=r;
        }
        return n;
    });
}

//write
//Create relationships for node n
//requires presence of n.relationships
function createRelationships(n){
    var statements = [];
    for (let prop in n.relationships) {
        let rel = n.relationships[prop];
         for (let i = 0; i < rel.items.length; i++) {
            statements.push(relationship.createStatement(n,rel.predicate,rel.items[i]));
         }
    }
    return cypher.executeStatements(statements);
}



//write
function updateRelationships(n)
{
    //check passed in node against saved node for differences
    return relationship.difference(n).then(function(diff)
        {
            if (diff.length){
                var statements = [];
                for (var c = 0;c<diff.length;c++){
                    let changed = diff[c];
                    for (let i = 0; i < changed.add.length; i++) {
                        statements.push(relationship.createStatement(n,changed.predicate,changed.add[i]));
                    }
                    for (let i = 0; i < changed.remove.length; i++) {
                        statements.push(relationship.removeStatement(n,changed.predicate,changed.remove[i]));
                    }
                }
                return cypher.executeStatements(statements);
            }
        });
}
 //write
 function updateProperties(n){
        
         //update props
        var q = "match(n) where ID(n)={id} set n={props} return n,ID(n),LABELS(n)";
        return cypher.executeQuery(q, "row", { "id": n.id,"props": that.trimForSave(n) })
        .then(parseNodeData);
    }

//write
function updateLabels(n){

        label.addParents(n);
        n.labels=utils.pascalCase(n.labels);
        var statements=[];
        //check passed in node against saved node for differences
        return that.get(n)
            .then(function(existing){
            
            //simpler to 
            var arrLabelsToRemove = _.difference(existing.labels,n.labels);//The array to inspect, The values to exclude.
            var arrLabelsToAdd = _.difference(n.labels,existing.labels);
            
            if (arrLabelsToAdd.length || arrLabelsToRemove.length) {
                var sAddLabels = "";
                if (arrLabelsToAdd.length) {
                    sAddLabels = " set n:" + arrLabelsToAdd.join(":");
                }
                
                var sRemoveLabels = "";
                if (arrLabelsToRemove.length) {
                    sRemoveLabels = " remove n:" + arrLabelsToRemove.join(":");
                }
                statements.push({ statement: "match(n) where ID(n)=" + n.id + sRemoveLabels + sAddLabels});
            }
            
            //update item labels if changing Label property
            if (existing.label && existing.label != n.label && n.label) {
                statements.push({ statement: "match(n:" + existing.label + ") remove n:" + existing.label + " set n:" + n.label });
            }
            
           if (statements.length){
                return cypher.executeStatements(statements);
            }  
        });
}
//Returns an object containing properties defined by types in labels
//Requires n.labels
function getSchema(labels) {
    var label,t,schema = {};
    for (let i = 0; i < labels.length; i++) {
        label = labels[i];
        t = type.list[changeCase.camelCase(label)];
        if (!t) continue;//ignore if label does not have a type definition
        
        //can't use extend because need to ensure that required=true 
        //always takes precendence over required=false
        for (let key in t.props){
            let required=false;
            if (schema[key])
            {
                required = schema[key].required;
            }
            schema[key] = t.props[key];
            if (required){
                schema[key].required=true;
            }
        }
    }
    return schema;
}


function addSchema(n){
    n.schema = getSchema(n.labels);
    return n;
 }

var that = {
    //get node by (internal)ID or label
    get: function (id) {
        var parsed = utils.parseIdOrLabel(id);
        if (parsed.id){
             return getNodeById(parsed.id);
        }
        if (parsed.label){
             return getNodeByLabel(parsed.label) ;
        }
 
    }
    ,
    //Get node by (internal ID) or label
    //Add relationships
    getWithRels: function (id) {

        var parsed = utils.parseIdOrLabel(id);
        console.log(parsed);
        if (parsed.id){
            return getNodeById(parsed.id)
            .then(addRelationships);
        }
        
        if (parsed.label){
            return getNodeByLabel(parsed.label)
            .then(addRelationships);
        }

    }
    ,
    getRelatedItems:function(obj,reltype,reltypes,classDefs){
   
   //CANT GET IT TO WORK SO THAT IMAGES OF PAINTINGS ARE NOT LAZY LOADED (LOADED WITH THE PAINTING)
   //AND ALSO IN ANOTHER QUERY STILL GET IMAGE.IMAGE_OF .. >PAINTING
   
     //find out if class has any nolazy reltypes that need to be loaded with it
     let nolazy;
     _.forOwn(reltypes,r=>{
            _.forOwn(classDefs[r.class].reltypes,r2=>{
                  if (r2.nolazy ) nolazy = r2;
            })
        });
   
      
 
      /*
        //nolazy is only respected for outbound relationships
       // if (reltype.direction === 'out'){
                for (let k in reltypes){
                let r = reltypes[k];
              //  if (r.direction==="out")
             //   {
                    for (let j in classDefs[r.class].reltypes)
                {
                    let r2 = classDefs[r.class].reltypes[j];
                    if (r2.nolazy )
                    {
                        nolazy = r2;
                    }
                }
              //  }
                
            }
      
            
     //   }
        */
        
        let q;
        if (obj.class){//not sure why but no class is being set for images
            q  = " match (n:" + obj.class + ")";
        }
        else{
             q  = " match (n)";
        }
       
        let r =  reltype.predicate.lookup.toUpperCase();
        
        if (reltype.direction === "out"){
            q += " - [:" + r + "] -> (m:" + reltype.class + ") ";
         
        }
        else{
            q += " <- [:" + r + "] - (m:" + reltype.class + ") ";
        }
        
        //not sure if we need to respect the direction of the nolazy ?
        if (nolazy){
            q+= " - [:" + nolazy.predicate.lookup + "] -> (nz) ";//:" + nolazy.class + ") ";//NOT SURE HOW TO GET CORRCET CLASS FOR NOLAZY
        }

       // q += " where n.Lookup='" + obj.lookup + "' return m ";
        q += " where ID(n)=" + obj.id + " return m,ID(m) ";
        
        if (nolazy){
            q+=",collect(nz),collect(ID(nz))";
        }  
    
    console.log(q);

        //todo: work out efficient way to get images of pictures
        //have a rule that always gets images along with pictures (but not other types)
        //Remove the resolve function for image types if parent is picture

        return cypher.executeQuery(q).then(function(data){
            return  data.map(function(d){
                    let n = utils.camelCase(d.row[0]);
                    n.id=d.row[1];
                    
                       if (nolazy){
                           let ids = d.row[3].map(function(e){return {id:e}});
                           let props = d.row[2].map(function(e){return utils.camelCase(e)})
                           n[nolazy.predicate.lookup.toLowerCase()] = _.merge(ids,props);
                       }
        
                    return n;
                });
        });
    }
    ,
    
    getForGraphQL:function(id,c){
     
/*
             var q = utils.getMatch(id);
             
             q += "with n match (n)-[:INSTANCE_OF]->(class:Class)-[r]-(c:Class) ";
             q += "WHERE TYPE(r)<>'EXTENDS' ";
             q += " with n,r,c match n-[q]-a-[:INSTANCE_OF]->c where type(r) = type(q) ";
             q += " return n,ID(n),labels(n),type(r),collect(a) ";
             
            //returns relationships with 'has' properties eg picture has image
            //but returns nothing if there a no has relationships

            match (n:Label {Lookup:'Delacroix'})-[:INSTANCE_OF]->(class:Class)-[r]-(c:Class) 
            WHERE TYPE(r)<>'EXTENDS' 
            with n,r,c match n-[q]-a-[:INSTANCE_OF]->c where type(r) = type(q) 
            with n,a,c,r
            match c - [:EXTENDS*] -> (b:Class) - [:HAS] -> (d:Class) 
            with n,a,r
            match (a) -[]->(i)-[:INSTANCE_OF]->d 
            return type(r),collect(a),collect(i)
*/
            

             var statements = [];
             for (var key in c.reltypes){
                 
                 let r = c.reltypes[key].predicate.lookup.toUpperCase();
                 
                if (c.reltypes[key].direction === "out"){
                    statements.push (utils.getMatch(id) + " with n match n - [:" + r + "] -> m return n,collect(m) ");
                }
                else{
                    statements.push (utils.getMatch(id) + " with n match n <- [:" + r + "] - m return n,collect(m) ");
                }
             }
             console.log(statements);
             //todo: include 'has' properties eg painting images

            var out = {};
            return cypher.executeStatements(statements).then(function(results){

           
                let n = utils.camelCase(results[0].data[0].row[0]);

                let counter=0;
                for (var key in c.reltypes){
                      
                    let data = results[counter].data;
                      
                    data.forEach(function(d){
                        n[key]= d.row[1].map(function(e){
                            return utils.camelCase(e);
                        });
                    });
                      
                   counter +=1;
                }

              return n;
                
                
            });
          
                
       
    }
    ,
    //returns a new property object for the node
    //--removes any empty propertes
    //--removes id property as this is internal to neo4j
    //--removes labels property as this is persisted with labels in neo4j
    //--remove temp property as this data should not be persisted
    trimForSave : function (n) {
        
        var props = {};
        
        for (var key in n)
        {
            if (n[key] !== null && n[key] !== undefined && n[key] !== "" &&
            key !== "labels" && 
            key !== "labelled" && 
            key != "relationships" && 
            key != "image" && 
            key !== "id" && 
            key !== "temp" &&
            key !== "schema" &&
            key !== "web")//web links ?? not implemented yet
            {
                props[key] = n[key];
            }
        }
        return utils.pascalCase(props);
    }
    ,
    //TODO: 
    //for labels (types), type hierachy needs to be enforced - eg if Painter then add Person:Global,-----------------DONE
    //if Painting the add Picture:Creation. These will need to be kept updated.
    //when Lookup is updated, the corresponding label needs to be renamed MATCH (n:OLD_LABEL)  REMOVE n:OLD_LABEL SET n:NEW_LABEL--------------- DONE
    //when updating Type, label needs to be updated, when creating----------------------DONE
    //When we come to modifying labels on creations, their relationships will need to be kept updated
    save: function (n,user) {

        if (n.id > -1) { 
           return that.update(n,user);
        }
        else {
           return that.create(n,user);
        }
    }
    ,
    //n can be an object with any properties
    //the following properties have special meaning:
    //--id: must not be > -1 as this indicates an existing node
    //--labels: an array of strings. The node will be saved with these neo4j labels. Required.
    //--temp.relationships: relationships defined as properties. Not Required.
    //--temp.links: links .. ??? Not Required
    //user is an optional parameter
    //--if supplied and user exists a 'created' relationship is added
    //Following save each rel is created as a neo4j relationship
    create:function(n,user)
    {
        if (n.id >-1) throw ("Node must have ID < 0 for insert");
        if (!(n.labels instanceof Array)) throw ("Node must have labels array property");

        label.addParents(n);
        n.labels=utils.pascalCase(n.labels);
        var q = "create (n:" + n.labels.join(":") + " {props}) with n set n.created=timestamp() ";

        //if user passed as second argument create a link to the user from this node
        if (user) {
            q += " with n  MATCH (u:User {Lookup:'" + user.lookup + "'})  create (u) - [s:CREATED]->(n)";
        }
        q += " return n,ID(n)";

        return cypher.executeQuery(q, "row", { "props": that.trimForSave(n) })
            .then(function (result) {
                n = _.extend(n,parseNodeData(result));
                return createRelationships(n);
            })
            .then(function(){
                return that.getWithRels(n);
            });
    }

    ,
    update:function(n,user){

        if (n.id <=-1) throw ("Node must have ID >=0 for update");

        //NB Have to update labels before properties in case label property has been modified
        return  updateLabels(n).
                then(function(){
                    return updateProperties(n);
                }).
                then(function(){
                    return updateRelationships(n);
                }).
                then(function(){
                    return that.getWithRels(n);
                });
    }
    ,
    //Deletes node and relationships forever
    destroy: function (node) {

        var q = "match (n) where ID(n)=" + node.id + "  OPTIONAL MATCH (n)-[r]-()  delete n,r";
        return cypher.executeQuery(q);
    }
    ,
    //Logical delete (relationships are left intact)
    //--removes labels and adds label Deleted
    //--sets property deleted = timestamp
    //--stores labels in oldlabels property
    delete: function (node) {

        if (!node || !node.id){
            throw "node not supplied";
        }

        var q = "match(n)  where ID(n)=" + node.id + "  remove n:" + node.labels.join(':');
        q += " set n:Deleted,n.oldlabels={labels},n.deleted=timestamp()  return n,ID(n),LABELS(n)";
        
        return cypher.executeQuery(q, "row", { "labels": node.labels })
        .then(parseNodeData);
  
    }
    ,
    //Removes 'Deleted' label and restores old labels
    //Currently requires the 'oldlabels' property to be present on the node
    restore: function (node) {

        if (!node || !node.id){
            throw "node not supplied";
        }

        var q = "match(n)  where ID(n)=" + node.id + "  set n:" + node.oldlabels.join(':');
        q += " remove n:Deleted,n.oldlabels,n.deleted return n,ID(n),LABELS(n) ";

        return cypher.executeQuery(q)
        .then(parseNodeData);
    }
    ,
    getSchema:function(id){
        return that.getLabels(id).then(function(labels){
             return getSchema(labels);
        });
    }
    ,
    getLabels:function(id){
        var q = utils.getMatch(id) + " with n return LABELS(n)";
        return cypher.executeQuery(q)
        .then(function (data) {
            if (data.length) {
                return data[0].row[0];
            }
            else {
                return [];
            }
        });
    }
    ,
    list:{
        //returns an array of nodes that have this label
        labelled: function (label,limit) {
            
            limit = limit || 500;
            var q = "match (n:" + changeCase.pascalCase(label) + ") return ID(n),n limit " + limit;
           console.log(q);
            return cypher.executeQuery(q).then(function (data) {
        
                var labelled = [];
                for (var i = 0; i < data.length; i++) {
                    let item = utils.camelCase(data[i].row[1]);
                    item.id=data[i].row[0];
                    labelled.push(item);
                }
                console.log(labelled);
                return labelled;
            });

        }
        ,
        search:function(baseType,baseArgs,selections,fragments,classDefs){
        
        
            let query = {
                type:baseType,
                args :
                { 
                    reltypes:_.omitBy(_.mergeWith(_.clone(baseArgs), _.clone(baseType.reltypes), (arg,reltype)=>{
                    return _.assignIn(reltype,{target:arg});
                    }),val=>!val.target),
                        props:_.omitBy(_.mergeWith(_.clone(baseArgs), _.clone(baseType.props), (arg,prop)=>{
                        return _.assignIn(prop,{target:arg});
                    }),val=>!val.target)
                }
                ,
                selection:{}
                ,
                q:"",
                params:{}
                
            };
            
            function mergeFragments(selections){
                
                let out = (new Array()).concat(selections);
                //merge fragments into selections
                selections.forEach(s=>{
                    if (s.kind==="FragmentSpread"){
                        let fragSelections = fragments[s.name.value].selectionSet.selections;
                        fragSelections = mergeFragments(fragSelections);
                        out = out.concat(fragSelections);
                    }
                })
                
                return out;
            
            }
            
            //merge fragments into selections
            let mergedSelections = (new Array()).concat(selections);
            selections.forEach(s=>{
                if (s.kind==="FragmentSpread"){
                    let fragSelections = fragments[s.name.value].selectionSet.selections;
                    fragSelections = mergeFragments(fragSelections);
                    mergedSelections = mergedSelections.concat(fragSelections);
                }
            })
            
            selections = mergedSelections;
           
            query.relAliases=new Array();
            
            query.neo = neo(query);
            
            let aliasPrefixes = ("a,b,c,d,e,f,g,h,i,j,k,l,m,n,o,p,q,r,s,t,u,v,w,x,y,z").split(",");
            
        
            
            function neo(s,level,aliases,aliasprefix,parentAlias,query){
 
                function neoRelationship(reltype,relAlias){
             
                    relAlias = relAlias || "";
                    
                    if (reltype.predicate.symmetrical){
                    return " - [" + relAlias + ":" + reltype.predicate.lookup + "] - ";
                    }
                    else if (reltype.direction === "out"){
                    return " - [" + relAlias + ":" + reltype.predicate.lookup + "] -> ";
                    }
                    else{
                    return " <- [" + relAlias + ":" + reltype.predicate.lookup + "] - ";
                    }
                    //  q+= "(m:Label {Label:'" + rel.target + "'}) ";
                }
            
                function neoTarget(reltype,level){
                
                    let alias = "t" + level;
                    
                    if (reltype.target){
                        return "(" + alias + ":" + reltype.class + " {Lookup:'" + reltype.target + "'}) ";
                    }
                    else{
                        return "(" + alias + ":" + reltype.class + ")";
                    }
                    //  q+= "(m:Label {Label:'" + rel.target + "'}) ";
                }
                
                aliases = aliases || new Array();
                level = level || 0;
                aliasprefix = aliasprefix || "a";
                query = query || s;//base query
                let q = "";
                let params={};
                let alias = aliasprefix + level;
                let withAliases = "";
                

                if (aliases.length){
                    q = " with " + aliases.join(",") + " ";
                }
                if (query.relAliases.length){//not currently in use but might be needed if graph type if required at some point
                    q+="," + query.relAliases.join(",");
                }
                
                aliases.push(alias);
                withAliases = " with " + aliases.join(",") + " ";
                if (query.relAliases.length){
                    withAliases+="," + query.relAliases.join(",");
                }
                
                let match = alias + ":" + s.type.lookup;
                if (s.args.props.labels){
                    match += ":" + s.args.props.labels.target.split(",").join(":");
                }
                q += " match (" + match + ") ";

               // args.reltypes form additional filtering via relationship
               // args.props form additional filtering via where clause
                
                _.forOwn(s.args.reltypes,reltype=>{
                    q+= withAliases + " match (" + alias + ") " + neoRelationship(reltype) + neoTarget(reltype,level);
                })

                let cnt = 0;

                _.forOwn(s.args.props,prop=>{
                    if (prop.name != "labels"){
                        if (cnt ===0){
                            q +=" where ";
                        }
                        else{
                            q+= " and ";
                        }
                        
                        if (prop.name === "id"){
                            q+= "ID(" + alias + ") = {" + alias + prop.name + "} ";
                        }
                        else {
                        let comparer = "=";
                        if (prop.target.indexOf("*") === 0 || prop.target.indexOf("*")===prop.target.length-1 ){
                            comparer = "=~";
                            prop.target.replaceAll('*','.*');
                        }
                        q+= alias + "." + changeCase.pascalCase(prop.name) + " " + comparer + " {" + alias + prop.name + "} ";
                        }
                        
                    
                        params[alias + prop.name] = prop.target;
                        cnt +=1;
                    }
                })
                
                
               // if (s.reltype) then query acts on a relationship with parent alias
               // (otherwise it starts with just the type (base query))
                if (s.reltype){
                    let relAlias = parentAlias + "_" + alias;
                    q += withAliases + " match (" + parentAlias + ") " + neoRelationship(s.reltype,relAlias) + "(" + alias + ") ";
                    query.relAliases.push(relAlias);
                }
                
              //accumulate query and params
              query.q += " " + q + " ";
              _.assignIn(query.params,params);

                return {
                    alias:alias,
                    q:q,
                    params:params
                }
           }
     
            
            function recursiveSelection(s,selection,parentType,level,aliases,aliasPrefix,parentAlias,query){
                
               if (s.selectionSet && s.kind!=="FragmentSpread"){

                    let reltype=s.name.value;
                    let type = classDefs[parentType.reltypes[reltype].class];
                    let args = _.mapValues(
                        _.keyBy(s.arguments.map(
                            arg=>({key:arg.name.value,value:arg.value.value})),'key')
                            ,val=>val.value);
                            
                    selection[reltype] = {
                        type:type   
                        ,
                        args: {
                          reltypes:_.omitBy(_.mergeWith(_.clone(args), _.clone(type.reltypes), (arg,reltype)=>{
                            return _.assignIn(reltype,{target:arg});
                        }),val=>!val.target),
                            props:_.omitBy(_.mergeWith(_.clone(args), _.clone(type.props), (arg,prop)=>{
                            return _.assignIn(prop,{target:arg});
                        }),val=>!val.target)
                        }
                        ,
                        reltype:parentType.reltypes[reltype]
                        ,
                        selection:{}
                    };
                        
                    selection[reltype].neo = neo(selection[reltype],level,aliases,aliasPrefix,parentAlias,query);
                    s.selectionSet.selections.forEach((sNext,i)=>{
                         recursiveSelection(sNext,selection[reltype].selection,type,level+1,aliases,aliasPrefixes[i],selection[reltype].neo.alias,query);
                    })
                  }
            }
            
            query.usedAliases = [query.neo.alias];
            selections.forEach((s,i)=>{
                 recursiveSelection(s,query.selection,baseType,1,query.usedAliases,aliasPrefixes[i],query.neo.alias,query);
            });
          

           query.q += " return " + query.usedAliases.join(",");
           if (query.relAliases.length){
               query.q+="," + query.relAliases.join(",");
           }
           let ids = query.usedAliases.map(alias=>{return "ID(" + alias + ")";})
           query.q += "," + ids.join(",");
           let labels = query.usedAliases.map(alias=>{return "LABELS(" + alias + ")";})
           query.q += "," + labels.join(",");

           return cypher.executeStatements([cypher.buildStatement(query.q,"row",query.params)]).then(function(results){
                let data = [];
                results[0].data.forEach(d=>{
                    let row = {};
                    let cnt = 0;
                    results[0].columns.forEach(col =>{
                        if (col.indexOf("ID(") === -1 && col.indexOf("LABELS(") === -1)
                        {
                            row[col]=utils.camelCase(d.row[cnt]);
                        }
                        else if (col.indexOf("ID(")===0){
                            let idForCol = col.replace("ID(","").replace(")","");
                            row[idForCol].id = d.row[cnt];
                        }
                        else if (col.indexOf("LABELS(")===0){
                            let labelsForCol = col.replace("LABELS(","").replace(")","");
                            row[labelsForCol].labels=d.row[cnt];
                        }
                  
                   
                        cnt+=1;
                    })
                    data.push(row)
                });
                
                let grouped = _.groupBy(data,(item)=>{return item.a0.id; });

                let reltypePrefix = "RELTYPE_";

                function fill(selection,row,obj){
                        _.forOwn(selection,(reltype,reltypekey)=>{
                            let k = reltypePrefix + reltypekey;
                            if (!obj[k]){
                                obj[k]={};
                            }
                            obj[k][row[reltype.neo.alias].id] = row[reltype.neo.alias];
                            fill(reltype.selection,row,obj[k][row[reltype.neo.alias].id]);
                        });
                    }
            
                let transformed = {};     
                
                _.forOwn(grouped,item=>{
                        item.forEach(row=>{
                            let out = row[query.neo.alias];
                            fill(query.selection,row,out);
                            if (transformed[out.id]){
                                transformed[out.id] = merge(transformed[out.id],out);
                            }
                            else{
                            transformed[out.id]=out;
                            }
                        });
                })

                function toArray(item){
                    _.forOwn(item,(val,key)=>{
                        if (key.indexOf(reltypePrefix) === 0)
                        {
                            let k= key.replace(reltypePrefix,"");
                            item[k]=[];
                            _.forOwn(val,(val2,key2)=>{
                                toArray(val2);
                                item[k].push(val2);
                            });
                        }
                    })
                }

                _.forOwn(transformed,item=>{
                    toArray(item);
                });

                return _.values(transformed);       
            });
        }
    }
};


return that;
 
};

