package main

import (
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{}

func ws(w http.ResponseWriter, r *http.Request) {
	c, _ := upgrader.Upgrade(w, r, nil)
	defer c.Close()
	for {
		_, msg, err := c.ReadMessage()
		if err != nil {
			break
		}

		c.WriteMessage(websocket.TextMessage, []byte("you said: "+string(msg)))
	}
}

func handler(w http.ResponseWriter, r *http.Request) {
	country := os.Getenv("CLOUDFLARE_COUNTRY_A2")
	location := os.Getenv("CLOUDFLARE_LOCATION")
	region := os.Getenv("CLOUDFLARE_REGION")

	fmt.Fprintf(w, "Hi, I'm a container running in %s, %s, which is part of %s ", location, country, region)
}

func main() {
	http.HandleFunc("/", handler)
	http.HandleFunc("/ws", ws)
	log.Fatal(http.ListenAndServe(":8080", nil))
}
