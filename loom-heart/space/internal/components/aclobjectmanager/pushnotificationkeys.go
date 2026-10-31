package aclobjectmanager

import (
	"errors"

	"github.com/anyproto/any-sync/util/crypto"

	"github.com/hoangtrung1801/loom/loom-heart/util/privkey"
)

const (
	spaceKeyPath = "m/99999'/1'"
	spacePath    = "m/SLIP-0021/anytype/space/key"
)

func pushDeriveSpaceKey(firstMetadataKey crypto.PrivKey) (crypto.PrivKey, error) {
	key, err := privkey.DeriveFromPrivKey(spaceKeyPath, firstMetadataKey)
	if err != nil {
		return nil, err
	}
	return key, nil
}

func pushDeriveSymmetricKey(readKey crypto.SymKey) (crypto.SymKey, error) {
	if readKey == nil {
		return nil, errors.New("readKey is nil")
	}
	raw, err := readKey.Raw()
	if err != nil {
		return nil, err
	}
	return crypto.DeriveSymmetricKey(raw, spacePath)
}
