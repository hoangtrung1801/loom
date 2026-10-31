package chatsubscription

import (
	"fmt"
	"testing"

	"github.com/hoangtrung1801/loom/loom-heart/core/block/chats/chatmodel"
	"github.com/hoangtrung1801/loom/loom-heart/core/block/editor/storestate"
)

func TestState(t *testing.T) {
	msgs := make([]*chatmodel.Message, 5)
	lexIds := storestate.LexId
	lastOrderId := lexIds.Next("")

	for i := range msgs {
		msg := givenSimpleMessage(fmt.Sprintf("msg-%d", i), fmt.Sprintf("text %d", i), "")
		msg.OrderId = lastOrderId
		msgs[i] = msg
		lastOrderId = lexIds.Next(lastOrderId)
	}

	st := newMessagesState(msgs, 5)

	msg := givenSimpleMessage(fmt.Sprintf("msg-%d", 5), fmt.Sprintf("text %d", 5), "")
	msg.OrderId = lastOrderId
	st.applyAddMessage("msg-5", msg.ChatMessage, "", true)

	buf := &eventsBuffer{
		events:        nil,
		eventsByMsgId: map[string]*eventsPerMessage{},
	}

	st.appendEventsTo("sub-1", buf)
}
