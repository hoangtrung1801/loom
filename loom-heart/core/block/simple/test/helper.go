package test

import (
	"github.com/hoangtrung1801/loom/loom-heart/core/block/simple"
	"github.com/hoangtrung1801/loom/loom-heart/pb"
)

func MakeEvent(events ...pb.IsEventMessageValue) []simple.EventMessage {
	eventMessages := make([]simple.EventMessage, 0, len(events))
	for _, event := range events {
		eventMessages = append(eventMessages, simple.EventMessage{
			Msg: &pb.EventMessage{Value: event},
		})
	}
	return eventMessages
}
