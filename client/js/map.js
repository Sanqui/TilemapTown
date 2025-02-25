/*
 * Tilemap Town
 *
 * Copyright (C) 2017-2023 NovaSquirrel
 *
 * This program is free software: you can redistribute it and/or
 * modify it under the terms of the GNU General Public License as
 * published by the Free Software Foundation; either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
var AtomTypes = {
  NONE      : "", // no special behavior
  SIGN      : "sign", // display a message upon being bumped into
  DOOR      : "door",
  CONTAINER : "container",
  ICE       : "ice",
  ESCALATOR : "escalator",
  WATER     : "water",
};

var AtomLayers = {
  TURF      : 0,
  OBJ       : 1,
  MOB       : 2,
  FLY       : 3,
};

var Directions = {
  EAST      : 0,
  SOUTHEAST : 1,
  SOUTH     : 2,
  SOUTHWEST : 3,
  WEST      : 4,
  NORTHWEST : 5,
  NORTH     : 6,
  NORTHEAST : 7,
}

// for converting direction IDs to actual offsets
var DirX = [ 1,  1,  0, -1, -1, -1,  0,  1];
var DirY = [ 0,  1,  1,  1,  0, -1, -1, -1];

class TownMap {
  constructor(MapWidth, MapHeight) {
    this.Width = MapWidth;
    this.Height = MapHeight;

    // Gets filled in from MAI
    this.Info = {name: "?", 'id': -1, 'owner': -1, 'default': 'grass', 'size': [60, 60], 'public': true, 'private': false, 'build_enabled': true, 'full_sandbox': true};

    // Initialize the map
    this.Tiles = [];
    this.Objs = [];
    for(var i=0; i<MapWidth; i++) {
      this.Tiles[i] = [];
      this.Objs[i] = [];
      for(var j=0; j<MapHeight; j++) {
        this.Tiles[i][j] = "grass";
        this.Objs[i][j] = [];
      }
    }
  }
}
var MyMap = new TownMap(60, 60);
var MapsByID = {}; // Includes the current map
var CurrentMapID = 0;

var IconSheets = {}; // tile sheets, indexed by first element in a 'pic'


var IconSheetsRequested = {};
var Tilesets = {};   // extra tilesets past just the Predefined list
var TilesetsRequested = {};

function RequestImageIfNeeded(id) {
  if(!IconSheets[id] && !IconSheetsRequested[id]) {
    // ask for the image
    IconSheetsRequested[id] = true;
    SendCmd("IMG", {"id": id});
  }
}

function FetchTilesetImage(id, url) {
  // unload an image
  if(url == null) {
    delete IconSheets[id];
    return;
  }
  // load an image
  var img = new Image();
  img.onload = function(){
    NeedMapRedraw = true;
    if(id <= 0)
      redrawBuildCanvas();
  };
  img.src = url;
  IconSheets[id] = img;
  delete IconSheetsRequested[id];
}

// add a new tileset to the list
function InstallTileset(name, list) {
  let new_set = {};

  // unpack each item
  for(let i=0; i<list.length/2; i++) {
    let tile = list[i*2+1];
    if(Array.isArray(tile))
      new_set[list[i*2]] = AtomCompact2JSON(tile);
    else
      new_set[list[i*2]] = tile;
  }

  Tilesets[name] = new_set;
}

// make a separate copy of an atom's object
function CloneAtom(atom) {
  return JSON.parse(JSON.stringify(atom));
}

// get an atom object from a string, or return it if already an object
function AtomFromName(str) {
  if(typeof str === "string") {
    if(Predefined[str])
      return Predefined[str];
    else {
      let s = str.split(":");
      if(s.length == 2) {
        // Allow a custom tileset
        if(Tilesets[s[0]] && Tilesets[s[0]][s[1]]) {
          return Tilesets[s[0]][s[1]];
        } else if(!TilesetsRequested[s[0]]) {
          // ask for the tileset
          TilesetsRequested[s[0]] = true;
          SendCmd("TSD", {id: s[0]});
        }
      }
      console.log("Unknown atom: "+str);
      return Predefined.grass;
    }
  }
  return str;
}

// convert an atom's JSON definition into a lower bandwidth version
function AtomJSON2Compact(t) {
  let out = [0, t.name, t.pic];

  // turn on flags and add fields as needed
  if(t.density)
    out[0] |= 1;
  if(t.obj)
    out[0] |= 2;
  if(t.type) {
    out[0] |= 4;
    out.push(t.type);
  }
  if(t.sort) {
    out[0] |= 8;
    out.push(t.sort);
  }
  if(t.dir) {
    out[0] |= 16;
    out.push(t.dir);
  }
  return out;
}

// convert a lower bandwidth atom into a JSON definition
function AtomCompact2JSON(t) {
  let flags = t[0];
  let out = {
    name: t[1],
    pic: t[2]
  };

  // interpret flags
  if(flags & 16)
    out.dir  = t.pop();
  if(flags & 8)
    out.sort = t.pop();
  if(flags & 4)
    out.type = t.pop();
  if(flags & 2)
    out.obj = true;
  if(flags & 1)
    out.density = true;
  return out;
}



function initMap() {
  if(Object.keys(IconSheets).length === 0) {
    IconSheets[0] = document.getElementById("potluck");
    IconSheets[-1] = document.getElementById("extras");
  }
}


// convert the map to a JSON object
function exportMap() {
  let turfs = [];
  let objs = [];
  let default_turf_json = JSON.stringify(AtomFromName(MapInfo['default']));

  // make a list of all objects
  for(let x=0; x<MapWidth; x++) {
    for(let y=0; y<MapHeight; y++) {
      if(MapTiles[x][y] && MapTiles[x][y] != MapInfo['default']
         && JSON.stringify(MapTiles[x][y]) != default_turf_json) {
        turfs.push([x, y, MapTiles[x][y]]);
      }
      if(MapObjs[x][y].length) {
        objs.push([x, y, MapObjs[x][y]]);
      }
    }
  }

  let Map = {'default': MapInfo['default'], 'obj': objs, 'turf': turfs, 'pos': [0, 0, MapWidth-1, MapHeight-1]};
  return "MAI\n"+JSON.stringify(MapInfo)+"\nMAP\n"+JSON.stringify(Map)+"\n";
}
