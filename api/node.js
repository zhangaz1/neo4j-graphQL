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
  
//node props , ID, labels
var parseNodeData = function(data){
    var n = utils.camelCase(data[0].row[0]);
    if (data[0].row[1]){
        n.id = data[0].row[1];
    }
    if (data[0].row[2]){
        n.labels = data[0].row[2];
        if (n.labels) n.labels.sort();
    }
    return n;
}

var getNode = function (match, where) {
    
    return cypher.executeQuery("match(" + match + ")  where " + where + " with n optional match (" + match + ") -[:IMAGE] - (i:Image:Main) return n,ID(n),LABELS(n),i ", "row")
    .then(function (data) {
        if (data.length) {

            var n = parseNodeData(data);
            n.image = image.configure(data[0].row[3]);
            addSchema(n);
            return n;
        }
        else {
            return null;
        }
    });
};

var getNodeById= function (id) {
    return getNode("n", "ID(n) = " + id );
};

var getNodeByLabel= function (label) {
    return getNode("n:Label", "n.Label = '" + label + "'");
};

var addRelationships = function (n) {
    if (n){
        return relationship.list.conceptual(n)
        .then(function(r){
            n.relationships=r;
            return n;
            //didn't ask for this so shouldn't strictly do it
            /*
            return that.list.labelled(n.Label,50).then(function(labelled){
                n.labelled= labelled;
                return n;
            });
            */
        });
    }
    else{
        return null;
    }
};

//Returns an object containing properties defined by types in labels
//Requires n.labels
var getSchema = function (n) {
    var schema = {};
        for (let i = 0; i < n.labels.length; i++) {
            let label = n.labels[i];
            if (!type.list[label]) continue;
            var t = type.list[label];//retrieve the type from the label text
            if (t.Props) {
                var arrProps = t.Props.split(',');
                for (let j = 0; j < arrProps.length; j++) {
                    var prop = changeCase.camelCase(arrProps[j]);
                    schema[prop] = "";
                }
            }
        }
        return schema;
    };


var addSchema = function(n){
        return _.extend(getSchema(n),n);
    };

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
        var q = "create (n:" + n.labels.join(":") + " {props}) with n set n.created=timestamp() ";

        //if user passed as second argument create a link to the user from this node
        if (user) {
            q += " with n  MATCH (u:User {Lookup:'" + user.lookup + "'})  create (u) - [s:CREATED]->(n)";
        }
        q += " return ID(n)";

        return cypher.executeQuery(q, "row", { "props": that.trimForSave(n) })
            .then(function (data) {
                n.id = data[0].row[0];
                return relationship.list.create(n);
            });
    }
    ,
    updateProperties:function(n){
        
         //update props
        var q = "match(n) where ID(n)={id} set n={props} return n,ID(n),LABELS(n)";
        return cypher.executeQuery(q, "row", { "id": n.id,"props": that.trimForSave(n) })
        .then(parseNodeData);
    }
    ,
    update:function(n,user){

        if (n.id <=-1) throw ("Node must have ID >=0 for update");

        var statements = [];
        
        //NB Have to update labels before properties in case label property has been modified
        return  label.update(n).then(
                that.updateProperties).then(
                relationship.list.update
                );  
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

        var statements = [];
        var q = "match(n)  where ID(n)=" + node.id + "  remove n:" + node.labels.join(':');
        q += " set n:Deleted,n.oldlabels={labels},n.deleted=timestamp()  return ID(n),n,LABELS(n)";
        
        //remove existing labels and add deleted label
        statements.push(cypher.buildStatement(q, "row", { "labels": node.labels }, true));
        return cypher.executeStatements(statements).then(function (results) {
            var nodeData = results[0].data[0].row;
            var deleted = nodeData[1];
            deleted.id = nodeData[0];
            deleted.labels = nodeData[2];
            return addSchema(deleted);
        });
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

        return cypher.executeQuery(q).then(function (results) {
            
            var nodeData = results[0].row;
            var saved = utils.camelCase(nodeData[0]);
            saved.id = nodeData[1];
            saved.labels = nodeData[2].sort();
            return addSchema(saved);
        });
    }
    ,
    getSchema:function(id){
        return that.get(id).then(getSchema);
    }
    ,
    list:{
        //returns an array of the labels (not pictures) that have this label
        labelled: function (label,limit) {
            
            limit = limit || 50;
            var statements = [];
            statements.push(cypher.buildStatement("match (n:Label:" + changeCase.pascalCase(label) + ") return ID(n),n.Lookup,n.Type,n.Label limit " + limit, "row"));
            return cypher.executeStatements(statements).then(function (results) {
                var labelled = [];
                var out = results[0].data;
                for (var i = 0; i < out.length; i++) {
                    var item = {
                        id: out[i].row[0],
                        lookup: out[i].row[1],
                        type: out[i].row[2],
                        label: out[i].row[3]
                    };
                    labelled.push(item);
                }
                return labelled;
            });

        }
    }
};


return that;
 
};

