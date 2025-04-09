# Load Balancer with KV

This example showcases how would you build a load balancer with DO containers and KV.

1. There is a central container manager that is used to poll containers and scale up/down through the API.
1. Once a container is healthy, it will add itself to the KV pool.
1. Once a container gets signalled, it will fail its healthchecks, which will make it remove itself from the KV pool.
1. If you hit `/lb`, the request will be load balanced across the available keys in KV.

