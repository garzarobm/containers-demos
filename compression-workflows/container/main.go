package main

import (
	"bytes"
	"fmt"
	"io"
	"net/http"

	"github.com/klauspost/compress/zstd"
)

var logs bytes.Buffer

func main() {
	requests := make(chan io.Reader, 10)
	http.HandleFunc("GET /compressions", func(w http.ResponseWriter, r *http.Request) {
		select {
		case r := <-requests:
			io.Copy(w, r)
		case <-r.Context().Done():
			return
		}
	})

	http.HandleFunc("PUT /compressions", func(w http.ResponseWriter, r *http.Request) {
		response, writer := io.Pipe()
		zstdWriter, err := zstd.NewWriter(writer, zstd.WithEncoderConcurrency(1))
		if err != nil {
			w.WriteHeader(500)
			logs.WriteString("error getting writer: " + err.Error())
			logs.WriteByte('\n')
			return
		}

		select {
		case requests <- response:
		default:
			w.WriteHeader(500)
			w.Write([]byte("server is overwhelmed"))
			return
		}

		n, err := io.Copy(zstdWriter, r.Body)
		fmt.Println("copied", n, err)
		zstdWriter.Close()
		writer.Close()
		w.WriteHeader(200)
	})

	http.ListenAndServe(":8002", nil)
}
