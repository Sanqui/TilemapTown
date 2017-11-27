# Building game
# Copyright (C) 2017 NovaSquirrel
#
# This program is free software: you can redistribute it and/or
# modify it under the terms of the GNU General Public License as
# published by the Free Software Foundation; either version 3 of the
# License, or (at your option) any later version.
#
# This program is distributed in the hope that it will be useful, but
# WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
# General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program.  If not, see <http://www.gnu.org/licenses/>.

import asyncio, datetime, random, websockets, json
from buildmap import *
from buildclient import *

# Global state variables
AllClients = set()
AllMaps = set()
ServerShutdown = False

MainMap = Map()
MainMap.load("maps/0.txt")
AllMaps.add(MainMap)

def filter_username(text):
	return ''.join([i for i in text if (i.isalnum() or i == '_')]).lower()

# Timer that runs and performs background tasks
def mainTimer():
	for c in AllClients:
		c.ping_timer -= 1
		if c.ping_timer == 60 or c.ping_timer == 30:
			c.send("PIN", None)
		elif c.ping_timer < 0:
			c.disconnect()

	if ServerShutdown:
		loop.stop()
	else:
		loop.call_later(1, mainTimer)

def escapeTags(text):
	return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

# Websocket connection handler
async def clientHandler(websocket, path):
	client = Client(websocket)
	client.map = MainMap
	client.map.users.add(client)
	AllClients.add(client)

	print("connected "+path)
	client.send("MAI", client.map.map_info())
	client.send("MAP", client.map.map_section(0, 0, client.map.width-1, client.map.height-1))
	client.map.broadcast("WHO", {'add': client.who()})
	client.send("WHO", {'list': client.map.who(), 'you': client.id})
	try:
		while True:
			# Read a message, make sure it's not too short
			message = await websocket.recv()
			if len(message) < 3:
				continue
            # Split it into parts
			command = message[0:3]
			arg = None
			if len(message) > 4:
				arg = json.loads(message[4:])
			if command == "MOV":
				client.map.broadcast("MOV", {'id': client.id, 'from': arg["from"], 'to': arg["to"]})
				client.x = arg["to"][0]
				client.y = arg["to"][1]
			elif command == "MSG":
				text = arg["text"];

				if text[0] == '/' and text[0:4].lower() != "/me ": # interpret user commands
					# separate into command and arguments
					space = text.find(" ")
					command2 = text[1:].lower()
					arg2 = ""
					if space >= 0:
						command2 = text[1:space].lower()
						arg2 = text[space+1:]

					if command2 == "nick":
						client.map.broadcast("MSG", {'text': client.name+" is now known as "+escapeTags(arg2)})
						client.name = escapeTags(arg2)
						client.map.broadcast("WHO", {'add': client.who()}) # update client view
					elif command2 == "saveme":
						if client.username == None:
							client.send("ERR", {'text': 'You are not logged in'})
						else:
							client.save()
							client.send("MSG", {'text': 'Account saved'})
					elif command2 == "changepass":
						if client.username == None:
							client.send("ERR", {'text': 'You are not logged in'})
						elif len(arg2):
							client.changepass(arg2)
							client.send("MSG", {'text': 'Password changed'})
						else:
							client.send("ERR", {'text': 'No password given'})
					elif command2 == "register":
						if client.username != None:
							client.send("ERR", {'text': 'Register fail, you already registered'})
						else:
							params = arg2.split()
							if len(params) != 2:
								client.send("ERR", {'text': 'Syntax is: /register username password'})
							else:
								if client.register(filter_username(params[0]), params[1]):
									client.map.broadcast("MSG", {'text': client.name+" has now registered"})
									client.map.broadcast("WHO", {'add': client.who()}) # update client view, probably just for the username
								else:
									client.send("ERR", {'text': 'Register fail, account already exists'})
					elif command2 == "login":
						params = arg2.split()
						if len(params) != 2:
							client.send("ERR", {'text': 'Syntax is: /login username password'})
						else:
							result = client.load(filter_username(params[0]), params[1])
							if result == True:
								client.map.broadcast("MSG", {'text': client.name+" has logged in ("+client.username+")"})
								client.map.broadcast("WHO", {'add': client.who()}) # update client view
							elif result == False:
								client.send("ERR", {'text': 'Login fail, bad password for account'})
							else:
								client.send("ERR", {'text': 'Login fail, nonexistent account'})
					elif command2 == "savemap":
						client.map.save('')
						client.map.broadcast("MSG", {'text': client.name+" saved the map"})
					else:
						client.send("ERR", {'text': 'Invalid command?'})
				else:
					client.map.broadcast("MSG", {'name': client.name, 'text': escapeTags(text)})
			elif command == "DEL":
				x1 = arg["pos"][0]
				y1 = arg["pos"][1]
				x2 = arg["pos"][2]
				y2 = arg["pos"][3]
				for x in range(x1, x2+1):
					for y in range(y1, y2+1):
						if arg["turf"]:
							client.map.turfs[x][y] = None;
						if arg["obj"]:
							client.map.objs[x][y] = None;
				client.map.broadcast("MAP", client.map.map_section(x1, y1, x2, y2))
			elif command == "PUT":
				x = arg["pos"][0]
				y = arg["pos"][1]
				if arg["obj"]:
					client.map.objs[x][y] = arg["atom"]
				else:
					client.map.turfs[x][y] = arg["atom"]
				client.map.broadcast("MAP", client.map.map_section(x, y, x, y))
			elif command == "PIN":
				client.ping_timer = 300

	except websockets.ConnectionClosed:
		print("disconnected")
	except:
		print("other error?")

	if client.username:
		client.save()

	# remove the user from all clients' views
	client.map.users.remove(client)
	client.map.broadcast("WHO", {'remove': client.id})
	AllClients.remove(client)

start_server = websockets.serve(clientHandler, None, 12550)

# Start the event loop
loop = asyncio.get_event_loop()
loop.call_soon(mainTimer)
loop.run_until_complete(start_server)
print("Server started!")
loop.run_forever()
websockets.close()
